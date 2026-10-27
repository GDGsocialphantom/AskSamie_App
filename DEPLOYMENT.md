# Deployment Guide

Full end-to-end setup for the AskSamie dashboard. Total time: 30 to 45 minutes.

Everything in this guide happens on **your own machine** (except final deploys to Cloudflare and GitHub). You'll need accounts on **Notion**, **Cloudflare**, and **GitHub** (all free).

## Prerequisites

- Node.js 18 or newer: https://nodejs.org
- Git configured with your GitHub account
- A terminal

If you cloned this repo, you already have everything you need in `server/`. If you're setting up from scratch, run:

```bash
git clone https://github.com/GDGsocialphantom/AskSamie_App.git
cd AskSamie_App/server
cp wrangler.example.toml wrangler.toml
```

---

## Part 1: Set up Notion

### 1a. Create a Notion integration

1. Go to https://www.notion.so/my-integrations
2. Click **+ New integration**
3. Name: `AskSAMIE Dashboard`. Workspace: your own. Type: **Internal**.
4. Click **Save**, reveal and copy the **Internal Integration Secret** (starts with `secret_` or `ntn_`). Save it, you'll paste it into Cloudflare in Part 2.

### 1b. Create the "Social Snapshots" database

1. In Notion, create a new page, type `/database`, pick **Table, Full page**.
2. Name it `Social Snapshots`.
3. Set up these exact columns (spelling and types matter):

| Column    | Type   | Notes                                                                                                                                                                                            |
| --------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name      | Title  | Already exists, leave as "Name"                                                                                                                                                                   |
| Date      | Date   | Add via **+**                                                                                                                                                                                     |
| Account   | Select | Add these 8 options: `AskSAMIE IG Content`, `AskSAMIE LI Content`, `AskSAMIE FB Content`, `AskSAMIE Long Form Content`, `Carelab Episode SEO Youtube`, `Carelab Audio Episode`, `OT Connected FB Content`, `OT Connected Long Form` |
| Followers | Number |                                                                                                                                                                                                  |

4. Click the **...** menu (top right) of the database page, then **Connections**, then **Connect to**, and pick `AskSAMIE Dashboard`.
5. Copy the database ID: with the database open as a page, the URL looks like `notion.so/xxxxx?v=yyyy`. The `xxxxx` (32 hex chars) is your **SOCIAL_DB_ID**.

### 1c. Create the "Monthly Sales" database

1. New page, `/database`, **Table, Full page**.
2. Name it `Monthly Sales`.
3. **Rename the default "Name" column to "Month"**: click the column header, Edit property, change Name to `Month`, keep type as Title.
4. Add these columns:

| Column       | Type   | Notes                                                             |
| ------------ | ------ | ----------------------------------------------------------------- |
| Month        | Title  | Format entries as `2026-01`, `2026-02`, etc.                      |
| Sales        | Number | Format: Dollar                                                    |
| Order Count  | Number |                                                                   |
| Top Products | Text   | Stores JSON; dashboard renders it visually. Don't hand-edit this. |

5. **...** menu, **Connections**, connect to `AskSAMIE Dashboard`.
6. Copy this database's ID from its URL. This is your **SALES_DB_ID**.

You now have three secrets: **NOTION_TOKEN**, **SOCIAL_DB_ID**, **SALES_DB_ID**.

### Adding Monthly Sales later (if you skipped 1c)

If the dashboard is up but you deferred the Monthly Sales database and now want to add it:

1. In Notion: create a new full-page database called `Monthly Sales` with the columns from 1c above
2. Connect the `AskSAMIE Dashboard` integration to it (**...** menu → Connections)
3. Copy the database ID from the URL
4. In Cloudflare → asksamie-dashboard-api → Settings → Variables and Secrets, add:
   - Name: `SALES_DB_ID`
   - Value: the database ID
   - Type: Text
5. Save. No Worker redeploy needed, variables apply on next request.
6. Reload the dashboard, upload a Shopify CSV. Save now persists to Notion instead of session-only. The orange "Session only" banner disappears.

---

## Part 2: Deploy the Cloudflare Worker

### 2a. Install Wrangler

```bash
npm install -g wrangler
wrangler login
```

Login opens a browser; authorize. If you don't have a Cloudflare account, sign up free at https://cloudflare.com first.

### 2b. Configure the Worker

```bash
cd server
cp wrangler.example.toml wrangler.toml
```

Open `wrangler.toml`, paste your two database IDs:

```toml
[vars]
SOCIAL_DB_ID = "your_social_db_id_here"
SALES_DB_ID  = "your_sales_db_id_here"
ALLOWED_ORIGIN = "*"
```

Leave `ALLOWED_ORIGIN = "*"` for now, you'll lock it down at the end.

### 2c. Deploy the Worker and set the secret

From the `server/` folder:

```bash
wrangler deploy
wrangler secret put NOTION_TOKEN
# When prompted, paste the secret_XXX or ntn_XXX token from Notion
```

The deploy prints a URL like:

```
https://asksamie-dashboard-api.<your-subdomain>.workers.dev
```

**Copy that URL.** Verify it works:

```bash
curl https://asksamie-dashboard-api.<your-subdomain>.workers.dev/health
# Should return: {"ok":true}
```

---

## Part 3: Seed Notion with historical data

Backfill the 354 social snapshots and 5 monthly sales rows you already have.

From the `server/` folder:

```bash
WORKER_URL=https://asksamie-dashboard-api.<your-subdomain>.workers.dev node seed.js
```

Expect ~3 minutes (paced to respect Notion's rate limit). You'll see:

```
Seeding 5 monthly sales rows...
  ok 2026-01: $9025.37
  ...
Seeding 354 social snapshot rows...
  20/354
  40/354
  ...
Done.
```

Open your Notion databases, they should be full. The script is idempotent, re-running replaces rather than duplicates.

---

## Part 4: Deploy the dashboard to GitHub Pages

### 4a. Point the dashboard at your Worker

Open `index.html` (project root). Near line 240, find:

```js
const WORKER_URL = 'https://REPLACE-ME.workers.dev';
```

Replace with your actual Worker URL.

### 4b. Commit and push

```bash
# From the project root
git add index.html README.md DEPLOYMENT.md .gitignore server/
git commit -m "Initial dashboard deploy"
git push -u origin main
```

The `.gitignore` prevents `server/wrangler.toml`, `node_modules/`, and local data from being pushed, so your DB IDs and token stay private.

### 4c. Enable GitHub Pages

1. In the GitHub repo, go to **Settings** then **Pages**
2. **Source**: Deploy from a branch
3. **Branch**: `main`, folder: `/ (root)`
4. Save.

After ~1 minute you get a URL like `https://gdgsocialphantom.github.io/AskSamie_App/`. Open it, the dashboard should load your Notion data.

### 4d. Lock down the Worker origin

Now that you know the Pages URL, restrict the Worker to only accept requests from it. Edit `server/wrangler.toml`:

```toml
ALLOWED_ORIGIN = "https://gdgsocialphantom.github.io"
```

Redeploy:

```bash
cd server
wrangler deploy
```

This stops anyone else from calling your Worker from another site.

---

## Using the dashboard

- **Add a social snapshot**: Update Data tab, fill the form, Save. Writes to Notion, chart refreshes.
- **Upload a Shopify CSV**: Update Data tab, choose file, confirm preview, save. Overwrites months present in the CSV; leaves others alone.
- **Edit a row in Notion directly**: Open the Notion database, change a number. Refresh the dashboard, change appears. Great for one-off corrections.
- **Delete a snapshot**: Update Data tab, recent list, delete button. Or archive the row in Notion.

---

## Common issues

**"Could not load data from the API" on page load** — check the browser console. Usually one of:
- `WORKER_URL` still says `REPLACE-ME` in `index.html`
- `wrangler.toml` still has placeholder DB IDs
- `NOTION_TOKEN` never got set (`wrangler secret put NOTION_TOKEN`)
- Databases not shared with the integration (Notion **...** then Connections)

**CORS error in browser console** — `ALLOWED_ORIGIN` doesn't match your Pages URL exactly. Compare: protocol (`https://`), no trailing slash. Fix and redeploy the Worker.

**"Notion API 400: property X does not exist"** — a column name in Notion doesn't match. They must be exact: `Date`, `Account`, `Followers`, `Month`, `Sales`, `Order Count`, `Top Products`.

**Rate-limited during seeding** — `seed.js` already paces itself. If you hit limits, bump the delay in `seed.js` from `400` ms to `600` ms and rerun.

**GitHub Pages not updating after push** — Actions tab in the repo shows the Pages deploy status. Usually takes 30 to 90 seconds. Hard refresh (Cmd+Shift+R).
