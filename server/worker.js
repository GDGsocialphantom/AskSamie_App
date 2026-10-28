// Cloudflare Worker — Notion API proxy for the AskSAMIE growth dashboard.
// Handles CORS + auth + schema translation so the browser can talk to Notion
// without ever seeing the Notion token.
//
// Required env vars (set in Cloudflare dashboard; NOTION_TOKEN as Secret):
//   NOTION_TOKEN     secret_XXX or ntn_XXX from your Notion integration
//   SOCIAL_DB_ID     database ID for the Social Media Channel Growth Tracker
//   ALLOWED_ORIGIN   e.g. https://asksamie-app.pages.dev  (or "*" while testing)
//
// Bindings (set under Settings → Bindings in Cloudflare):
//   SALES_KV         KV namespace storing monthly sales as a single JSON blob.
//                    If unbound, sales endpoints return empty and the dashboard
//                    falls back to session-only sales.
//
// Schema the Worker reads from the social database:
//   Snapshot      Title
//   Date          Date
//   Account       Select (one of the 8 account names)
//   Subscribers   Number (treated as "followers" in the dashboard)

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
// Reads from Brandy's existing Social Media Channel Growth Tracker database.
// Property names:  Snapshot (title), Date, Account (select), Subscribers (number).
// The dashboard calls this value "followers" for display consistency.
async function getSocial(env) {
  const pages = await queryAll(env.SOCIAL_DB_ID, null, env);
  return pages
    .map(page => {
      const p = page.properties;
      return {
        id: page.id,
        date: p.Date?.date?.start,
        account: p.Account?.select?.name,
        followers: p.Subscribers?.number ?? 0,
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
      'Snapshot': { title: [{ text: { content: `${account} — ${date}` } }] },
      'Date': { date: { start: date } },
      'Account': { select: { name: account } },
      'Subscribers': { number: Number(followers) },
    },
  }, env);
  return { id: created.id, date, account, followers: Number(followers) };
}

async function archivePage(id, env) {
  await notionFetch(`/pages/${id}`, 'PATCH', { archived: true }, env);
  return { id, archived: true };
}

// ===== Monthly Sales =====
// Stored in Cloudflare KV under a single key "sales" as a JSON array.
// Bind a KV namespace to the Worker as SALES_KV. If unbound, returns empty
// and writes fall back to session-only (handled by the dashboard).
const SALES_KEY = 'sales';

async function readSalesArray(env) {
  const raw = await env.SALES_KV.get(SALES_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch (_) { return []; }
}

async function getSales(env) {
  if (!env.SALES_KV) return [];
  const all = await readSalesArray(env);
  return all
    .filter(r => r && /^\d{4}-\d{2}$/.test(r.month))
    .sort((a, b) => a.month.localeCompare(b.month));
}

async function upsertSales({ month, sales, orderCount, topProducts }, env) {
  if (!env.SALES_KV) throw new Error('SALES_KV not bound — create a KV namespace in Cloudflare and bind it to this Worker as SALES_KV');
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Month must be YYYY-MM');
  const all = await readSalesArray(env);
  const row = {
    month,
    sales: Number(sales) || 0,
    orderCount: Number(orderCount) || 0,
    topProducts: Array.isArray(topProducts) ? topProducts : [],
  };
  const idx = all.findIndex(s => s && s.month === month);
  if (idx >= 0) all[idx] = row; else all.push(row);
  all.sort((a, b) => a.month.localeCompare(b.month));
  await env.SALES_KV.put(SALES_KEY, JSON.stringify(all));
  return row;
}
