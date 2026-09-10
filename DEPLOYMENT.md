# Deployment Guide

Walkthrough for deploying the **Life Tool** hub (dashboard + Mark Six PWA) to production: hosting on **Render**, storage on **Supabase**.

---

## Prerequisites

- A GitHub repo with this project (e.g. `beartoinfinity-crypto/mark-six-pwa`)
- A **Supabase** project (free tier is plenty) with your project URL and publishable/anon key
- A **Render** account

---

## 1. Set up Supabase (database)

All draw history is stored in Supabase (PostgreSQL).

1. Create a project at [supabase.com](https://supabase.com).

2. In the dashboard, open **SQL Editor** and run `apps/mark-six/supabase-schema.sql`:

   ```sql
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

   create table if not exists public.meta (
     key text primary key,
     value text,
     updated_at timestamptz not null default now()
   );

   alter table public.draws enable row level security;
   alter table public.meta enable row level security;
   create policy "allow all draws" on public.draws for all using (true) with check (true);
   create policy "allow all meta" on public.meta for all using (true) with check (true);
   ```

3. Note your credentials from **Settings → API**:
   - `SUPABASE_URL` e.g. `https://<project-ref>.supabase.co`
   - `SUPABASE_KEY` — the **anon / publishable** key

4. **Load historical data** (optional). The server auto-fills ~4,300 draws when the table is empty.

---

## 2. Create the `.env` file (local)

```bash
cp .env.example .env   # then edit
```

```ini
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_KEY=your-publishable-key
PORT=3000
```

Verify locally:

```bash
npm install
npm start
# open http://localhost:3000  (dashboard)
# open http://localhost:3000/mark-six/  (Mark Six)
# open http://localhost:3000/bus-eta/  (HK Bus ETA)
```

---

## 3. Deploy to Render

Both methods need these environment variables on the Render service:

| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | `https://<your-project>.supabase.co` |
| `SUPABASE_KEY` | your publishable/anon key |
| `NODE_VERSION` | `22` |

> ⚠️ **Node 22 is required.** Recent `@supabase/supabase-js` needs native WebSocket (Node 20 crashes with `Native WebSocket not found`).

### Option A — Render Blueprint (uses `render.yaml`)

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
        sync: false
      - key: SUPABASE_KEY
        sync: false
    healthCheckPath: /
```

1. In Render: **New+ → Blueprint**.
2. Connect GitHub and choose the repo.
3. Supply `SUPABASE_URL` and `SUPABASE_KEY` (or set them later under **Environment**).
4. **Apply**. Render provisions and deploys.

### Option B — Manual web service

1. In Render: **New+ → Web Service**.
2. Connect GitHub → select the repo.
3. Configure:
   - **Environment:** Node
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
   - **Instance type:** Free
4. Under **Environment**, add `SUPABASE_URL`, `SUPABASE_KEY`, `NODE_VERSION = 22`.
5. **Create Web Service**.

HTTPS is automatic, at a URL like `https://mark-six-pwa.onrender.com`.

### What you get

- `https://mark-six-pwa.onrender.com/` → **dashboard** (launcher cards)
- `https://mark-six-pwa.onrender.com/mark-six/` → **Mark Six PWA**
- `https://mark-six-pwa.onrender.com/bus-eta/` → **HK Bus ETA PWA** (prebuilt static bundle committed under `apps/hk-bus-eta/build/` — no build step on the server)

---

## 4. Keep it updated

Render auto-deploys on push to the connected branch (default on). To deploy manually: **Manual Deploy → Deploy latest commit**.

After a deploy, hard-refresh clients (or clear the app's service-worker data) so the new app shell is fetched — the service worker cache is versioned and updates on the next visit.

---

## Troubleshooting

### Deploy crashes: `Native WebSocket not found`
Fix: set `NODE_VERSION=22` and redeploy.

### Page stuck on "Fetching latest results"
- Confirm `SUPABASE_URL` / `SUPABASE_KEY` are set and the tables exist.
- Free-tier instances sleep after ~15 min idle; first request after sleep cold-starts slowly.

### Results show 6 numbers but no special number
- Stale client cache — tap the refresh button or clear the site/service-worker data.
- If rows truly lack `special`, hit `/mark-six/api/marksix/refresh` (the parser extracts the special ball).

### Tables missing (`Could not find the table 'public.draws'`)
Run `apps/mark-six/supabase-schema.sql` in the Supabase SQL Editor.

### `/mark-six` redirect loops
Ensure the hub server has the exact-match redirect (`req.originalUrl.split('?')[0] === '/mark-six'`), not a plain `get('/mark-six')` — Express non-strict routing would otherwise match the trailing-slash path too and loop.

---

## Cost / limits

| Service | Tier | Notes |
|---------|------|-------|
| Render | Free | Spins down after ~15 min idle; 512 MB RAM; 50s request cap |
| Supabase | Free | 500 MB, 2 projects — plenty for ~4,300 rows |