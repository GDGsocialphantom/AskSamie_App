// Cloudflare Worker — Notion API proxy for the AskSAMIE growth dashboard.
// Handles CORS + auth + schema translation so the browser can talk to Notion
// without ever seeing the Notion token.
//
// Required env vars (set in wrangler.toml for non-secrets, wrangler secret for NOTION_TOKEN):
//   NOTION_TOKEN     secret_XXX or ntn_XXX from your Notion integration
//   SOCIAL_DB_ID     database ID for Social Snapshots
//   SALES_DB_ID      database ID for Monthly Sales
//   ALLOWED_ORIGIN   e.g. https://gdgsocialphantom.github.io  (or "*" while testing)

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const parts = url.pathname.split('/').filter(Boolean);
    const resource = parts[0];
    const id = parts[1];

    try {
      if (resource === 'social') {
        if (request.method === 'GET') return json(await getSocial(env), cors);
        if (request.method === 'POST') return json(await addSocial(await request.json(), env), cors);
        if (request.method === 'DELETE' && id) return json(await archivePage(id, env), cors);
      }
      if (resource === 'sales') {
        if (request.method === 'GET') return json(await getSales(env), cors);
        if (request.method === 'POST') return json(await upsertSales(await request.json(), env), cors);
      }
      if (resource === 'health') return json({ ok: true }, cors);
      return json({ error: 'Not found', path: url.pathname }, cors, 404);
    } catch (e) {
      return json({ error: e.message }, cors, 500);
    }
  }
};

function json(data, cors, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

async function notionFetch(path, method, body, env) {
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${NOTION_API}${path}`, opts);
  const text = await r.text();
  if (!r.ok) throw new Error(`Notion API ${r.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

async function queryAll(dbId, filter, env) {
  const results = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    if (filter) body.filter = filter;
    const data = await notionFetch(`/databases/${dbId}/query`, 'POST', body, env);
    results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

// ===== Social Snapshots =====
async function getSocial(env) {
  const pages = await queryAll(env.SOCIAL_DB_ID, null, env);
  return pages
    .map(page => {
      const p = page.properties;
      return {
        id: page.id,
        date: p.Date?.date?.start,
        account: p.Account?.select?.name,
        followers: p.Followers?.number ?? 0,
      };
    })
    .filter(r => r.date && r.account)
    .sort((a, b) => a.date.localeCompare(b.date) || a.account.localeCompare(b.account));
}

async function addSocial({ date, account, followers }, env) {
  if (!date || !account || followers == null) throw new Error('Missing date, account, or followers');

  const existing = await queryAll(env.SOCIAL_DB_ID, {
    and: [
      { property: 'Date', date: { equals: date } },
      { property: 'Account', select: { equals: account } },
    ],
  }, env);
  for (const p of existing) {
    await notionFetch(`/pages/${p.id}`, 'PATCH', { archived: true }, env);
  }

  const created = await notionFetch('/pages', 'POST', {
    parent: { database_id: env.SOCIAL_DB_ID },
    properties: {
      'Name': { title: [{ text: { content: `${account} — ${date}` } }] },
      'Date': { date: { start: date } },
      'Account': { select: { name: account } },
      'Followers': { number: Number(followers) },
    },
  }, env);
  return { id: created.id, date, account, followers: Number(followers) };
}

async function archivePage(id, env) {
  await notionFetch(`/pages/${id}`, 'PATCH', { archived: true }, env);
  return { id, archived: true };
}

// ===== Monthly Sales =====
async function getSales(env) {
  const pages = await queryAll(env.SALES_DB_ID, null, env);
  return pages
    .map(page => {
      const p = page.properties;
      const month = p.Month?.title?.[0]?.plain_text?.trim();
      const topRaw = p['Top Products']?.rich_text?.map(t => t.plain_text).join('') || '';
      let topProducts = [];
      try { topProducts = topRaw ? JSON.parse(topRaw) : []; } catch (_) {}
      return {
        id: page.id,
        month,
        sales: p.Sales?.number ?? 0,
        orderCount: p['Order Count']?.number ?? 0,
        topProducts,
      };
    })
    .filter(r => /^\d{4}-\d{2}$/.test(r.month))
    .sort((a, b) => a.month.localeCompare(b.month));
}

async function upsertSales({ month, sales, orderCount, topProducts }, env) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Month must be YYYY-MM');
  const props = {
    'Month': { title: [{ text: { content: month } }] },
    'Sales': { number: Number(sales) || 0 },
    'Order Count': { number: Number(orderCount) || 0 },
    'Top Products': {
      rich_text: [{ text: { content: JSON.stringify(topProducts || []).slice(0, 1900) } }],
    },
  };
  const existing = await queryAll(env.SALES_DB_ID, {
    property: 'Month', title: { equals: month },
  }, env);
  if (existing.length) {
    const first = existing[0];
    for (const dupe of existing.slice(1)) {
      await notionFetch(`/pages/${dupe.id}`, 'PATCH', { archived: true }, env);
    }
    await notionFetch(`/pages/${first.id}`, 'PATCH', { properties: props }, env);
    return { id: first.id, month, sales, orderCount, topProducts };
  } else {
    const created = await notionFetch('/pages', 'POST', {
      parent: { database_id: env.SALES_DB_ID },
      properties: props,
    }, env);
    return { id: created.id, month, sales, orderCount, topProducts };
  }
}
