# AskSamie Dashboard

A live, shareable dashboard tracking social media follower growth across content channels and Shopify product sales for **AskSAMIE** and **OT Connected**.

**Live URL:** https://gdgsocialphantom.github.io/AskSamie_App/ *(enable GitHub Pages first, see below)*

## What it does

- Charts follower growth over time for 8 content channels (IG, LinkedIn, Facebook, YouTube Long Form, Carelab, OT Connected)
- Toggle any account on or off on the overview chart
- Click any per-account chart to see its full data table
- Combo chart comparing combined AskSAMIE followers against monthly product sales
- Upload Shopify order exports to auto-compute monthly totals and top 3 revenue products per month
- Everyone with the link sees the same data; edits sync in real time

## Architecture

```
Browser (GitHub Pages)  --->  Cloudflare Worker  --->  Notion API
                              (holds Notion token)     (2 databases)
```

The browser never sees the Notion token; the Worker is the only thing that talks to Notion directly.

## Repository layout

```
index.html              Dashboard, deploys to GitHub Pages
README.md               This file
DEPLOYMENT.md           Full deployment walkthrough
.gitignore              Keeps secrets and local config out of git
server/                 Code for the Cloudflare Worker proxy
  worker.js             The Worker itself (deployed to Cloudflare)
  wrangler.example.toml Template config
  wrangler.toml         Real config with DB IDs (gitignored, local only)
  seed.js               One-time Notion seeder for historical data
  package.json
  data/                 Historical seed data
```

## Setup

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the full step-by-step walkthrough covering Notion, Cloudflare, GitHub Pages, and seeding your historical data.

## Costs

Free, assuming you stay in free tiers:
- Notion: free on any plan
- Cloudflare Workers: 100,000 requests/day free (you'll use ~50/day)
- GitHub Pages: free for public repos
