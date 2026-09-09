# Deployment Guide

This document walks through deploying the **Mark Six PWA** to production: hosting on **Render** with storage on **Supabase**.

---

## Prerequisites

- A GitHub repo with this project (e.g. `beartoinfinity-crypto/mark-six-pwa`)
- A **Supabase** project (the free tier is plenty) with your project URL and publishable/anon key
- A **Render** account

---

## 1. Set up Supabase (database)

The app stores all draw history in Supabase (PostgreSQL).

1. Create a project at [supabase.com](https://supabase.com).

2. In the dashboard, open **SQL Editor** and run the entire contents of `supabase-schema.sql`:

   ```sql
   -- Draws table
   create table if not exists public.draws (
     id bigint generated always as identity primary key,
     draw text not null unique,
     date text not null,
     numbers text not null,
     special integer,
     source text,
     created_at timestamptz not null default now()
   );
   create index if not exists idx_draws_date on public.draws (date);
   create index if not exists idx_draws_draw on public.draws (draw);

   -- Meta table
   create table if not exists public.meta (
     key text primary key,
     value text,
     updated_at timestamptz not null default now()
   );

   -- RLS (permissive, keyed to the anon/publishable key)
   alter table public.draws enable row level security;
   alter table public.meta enable row level security;
   create policy "allow all draws" on public.draws for all using (true) with check (true);
   create policy "allow all meta" on public.meta for all using (true) with check (true);
   ```

3. Note your credentials from **Settings → API**:
   - `SUPABASE_URL` e.g. `https://<project-ref>.supabase.co`
   - `SUPABASE_KEY` — the **anon / publishable** key (suitable for server-side reads/writes here)

4. **Load historical data** (optional). The server auto-fills ~4,300 draws from GitHub when the table is empty. To load it manually:

   ```bash
   cd mark-six-pwa
   npm install
   # create .env (see step 2 below), then:
   npm start
   # first run detects an empty table and backfills history from GitHub
   ```

---

## 2. Create the `.env` file (local)

```bash
cd mark-six-pwa
cp .env.example .env
# edit .env
```

```ini
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_KEY=your-publishable-key
PORT=3000
```

`.env` is git-ignored. Verify locally with:

```bash
npm start
# open http://localhost:3000
```

---

## 3. Deploy to Render

There are two ways. Both need the same environment variables set on the Render service:

| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | `https://<your-project>.supabase.co` |
| `SUPABASE_KEY` | your publishable/anon key |
| `NODE_VERSION` | `22` |

> ⚠️ **Node 22 is required.** `@supabase/supabase-js` (current versions) needs native WebSocket, which is only available in Node **22+**. Using Node 20 causes the deploy to crash with `Native WebSocket not found`.

### Option A — Render Blueprint (uses `render.yaml`)

A `render.yaml` is included in the repo:

```yaml
services:
  - type: web
    name: mark-six-pwa
    runtime: node
    plan: free
    buildCommand: npm install
    startCommand: node server.js
    envVars:
      - key: NODE_VERSION
        value: 22
      - key: SUPABASE_URL
        sync: false      # set manually in the dashboard
      - key: SUPABASE_KEY
        sync: false      # set manually in the dashboard
```

1. In Render: **New+ → Blueprint**.
2. Connect GitHub and choose the `mark-six-pwa` repo.
3. When prompted, supply values for `SUPABASE_URL` and `SUPABASE_KEY` (or set them later under **Environment**).
4. Click **Apply**. Render provisions the service and deploys.

### Option B — Manual web service

1. In Render: **New+ → Web Service**.
2. Connect GitHub → select the `mark-six-pwa` repo.
3. Configure:
   - **Environment:** Node
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
   - **Instance type:** Free
4. Under **Environment**, add:
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
   - `NODE_VERSION = 22`
5. **Create Web Service**.

Render serves HTTPS automatically at a URL like `https://mark-six-pwa.onrender.com`.

---

## 4. Keep it updated

Render can **auto-deploy** on push to the connected branch (default on). To deploy manually:

1. Open the service in the Render dashboard.
2. **Manual Deploy → Deploy latest commit**.

After a deploy, hard-refresh the client (or clear the site's service worker data) so the new app shell is fetched — the service worker cache is versioned and updates on the next visit.

---

## Troubleshooting

### Deploy crashes: `Native WebSocket not found`
Cause: running Node 20 with a recent `@supabase/supabase-js`.
Fix: set the `NODE_VERSION=22` env var and redeploy.

### Page stuck on "Fetching latest results"
- Ensure `SUPABASE_URL` / `SUPABASE_KEY` are set and the tables exist (run `supabase-schema.sql`).
- Free-tier instances sleep after ~15 min idle; the first request after sleep cold-starts slowly.

### Results show 6 numbers but no special number
- A stale client cache. Tap the refresh button or clear the site/service-worker data.
- If the stored rows really lack `special`, re-scrape: hit `/api/marksix/refresh` (the parser now extracts the special ball).

### Tables missing (`Could not find the table 'public.draws'`)
Run `supabase-schema.sql` in the Supabase SQL Editor — the tables don't exist yet.

### First load slow every time
The app already serves cached data instantly on first visit. Remaining slowness is Render free-tier cold start; a paid instance removes it.

---

## Cost / limits

| Service | Tier | Notes |
|---------|------|-------|
| Render | Free | Spins down after ~15 min idle; 512 MB RAM; 50s request cap |
| Supabase | Free | 500 MB database, 2 projects — plenty for ~4,300 rows |
