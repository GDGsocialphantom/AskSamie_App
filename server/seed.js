// One-time seeder: reads data/seed-social.json and data/seed-sales.json,
// posts them to your deployed Cloudflare Worker to backfill Notion.
//
// Usage:
//   WORKER_URL=https://asksamie-dashboard-api.your-subdomain.workers.dev node seed.js
//
// Idempotent: existing records with the same date+account (social) or
// same month (sales) are replaced, so running it twice won't duplicate.

import fs from 'node:fs/promises';

const WORKER_URL = process.env.WORKER_URL?.replace(/\/$/, '');
if (!WORKER_URL) {
  console.error('Set WORKER_URL env var, e.g.:');
  console.error('  WORKER_URL=https://asksamie-dashboard-api.you.workers.dev node seed.js');
  process.exit(1);
}

const social = JSON.parse(await fs.readFile('./data/seed-social.json', 'utf8'));
const sales  = JSON.parse(await fs.readFile('./data/seed-sales.json',  'utf8'));

console.log(`Seeding ${sales.length} monthly sales rows...`);
for (const row of sales) {
  const r = await fetch(`${WORKER_URL}/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`Sales ${row.month} failed: ${r.status} ${await r.text()}`);
  console.log(`  ok ${row.month}: $${row.sales}`);
}

console.log(`\nSeeding ${social.length} social snapshot rows (this takes a few minutes)...`);
let n = 0;
for (const row of social) {
  const r = await fetch(`${WORKER_URL}/social`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`Social ${row.date} ${row.account} failed: ${r.status} ${await r.text()}`);
  n++;
  if (n % 20 === 0) console.log(`  ${n}/${social.length}`);
  await new Promise(res => setTimeout(res, 400));
}
console.log(`\nDone. Seeded ${sales.length} sales rows and ${social.length} social snapshots.`);
