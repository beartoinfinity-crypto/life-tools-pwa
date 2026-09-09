# Mark Six PWA

A Progressive Web App (PWA) that displays Hong Kong Mark Six lottery results. It pulls historical and latest results from multiple public sources, persists them to **Supabase (PostgreSQL)**, auto-refreshes on draw days (Tue/Thu/Sat), works offline, and is installable on iPhone/Android home screens.

- **Live app:** https://mark-six-pwa.onrender.com
- **Repo:** https://github.com/beartoinfinity-crypto/mark-six-pwa
- **Storage:** Supabase (PostgreSQL)
- **Hosting:** Render (Node.js)

---

## Features

- 📊 Shows the latest 10 draws, with "Load Older Results" to page through history
- 🔢 Displays 6 main numbers + the 1 **special number** (marked with a `+` and red ring)
- 🎨 Ball colors follow the official Mark Six color scheme (red/blue/green)
- 🔄 Auto-refreshes at midnight on draw days only (Tue/Thu/Sat)
- 🧭 Manual refresh button works any time
- 📱 Installable PWA — standalone app on Android & iOS
- 🛜 Offline support via a service worker (API is network-first, assets cache-first)
- 🗄️ All history (1993–present, ~4,300 draws) persisted in Supabase

---

## Quick Start (local)

```bash
cd mark-six-pwa
npm install
npm start
```

Open `http://localhost:3000` in a browser.

> Prerequisite: you need a Supabase project and a `.env` file — see [Supabase Setup](#supabase-setup-storage).

---

## Project Structure

```
mark-six-pwa/
├── server.js           # Production entry point — Express + Supabase
├── supabase-db.js      # Supabase client + async store operations
├── supabase-schema.sql # SQL: create tables + RLS in Supabase SQL Editor
├── parsers.js          # HTML/JSON parsers for each data source
├── app.js              # Client-side logic (UI, fetch, midnight refresh)
├── sw.js               # Service worker (offline caching)
├── index.html          # Main page
├── styles.css          # Mobile-first responsive styles
├── manifest.json       # PWA manifest
├── icons/icon.svg      # App icon
├── render.yaml         # Render Blueprint deploy config
├── package.json        # Dependencies & scripts
├── .env.example        # Template for environment variables
│
├── api.js              # Modular Express app (used by tests)
├── db.js               # In-memory SQLite store (used by tests)
├── scrapers.js         # HTTP fetch + scrape orchestrators (used by tests)
├── draw-day.js         # Draw-day logic (used by tests)
│
└── test/               # Vitest suite
    ├── parsers.test.js  # 21 tests
    ├── db.test.js       # 15 tests
    ├── api.test.js      #  8 tests
    ├── draw-day.test.js # 11 tests
    └── fixtures/        # Test HTML/JSON fixtures
```

> **Note:** `server.js` is the only runtime entry point used in production and by the live app. The `api.js`/`db.js`/`scrapers.js`/`draw-day.js` modules are the extracted logic used by the offline test suite (with an in-memory SQLite store). `draw-day.js` is imported by tests but not currently used by `server.js` at runtime.

---

## Architecture

### Data Flow

```
lotteryextreme.com ──┐
                     ├──▶ server.js ──▶ supabase-db.js ──▶ Supabase (PostgreSQL) ──▶ /api ──▶ Browser
GitHub JSON ──────── ┘
```

### Data Sources

| Source | Coverage | Used for |
|--------|----------|----------|
| lotteryextreme.com | Latest ~20 draws | Daily refresh (append-only), incl. special numbers |
| GitHub JSON | 1993–2025 (~4,288 draws) | Initial / historical backfill when DB is empty |
| lottery.hk | All years | Historical backfill (bounded to current/previous year; often times out from Render) |

### Database (Supabase)

Two tables, backed by the SQL in `supabase-schema.sql`:

```sql
CREATE TABLE draws (
  id       bigint generated always as identity primary key,
  draw     text not null unique,   -- e.g. "26/097"
  date     text not null,          -- ISO date "2026-09-08"
  numbers  text not null,          -- JSON array of 6 main numbers
  special  integer,                -- the special number
  source   text,                   -- "github" | "lotteryextreme" | ...
  created_at timestamptz not null default now()
);

CREATE TABLE meta (
  key   text primary key,
  value text,
  updated_at timestamptz not null default now()
);
```

Row Level Security (RLS) is enabled with permissive policies keyed to the publishable/anon key.

### API Endpoints (production `server.js`)

All endpoints take/return JSON.

| Method | Endpoint | Request body | Description |
|--------|----------|--------------|-------------|
| POST | `/api/marksix` | `{ "lastNDraw": 10 }` | Latest N draws from DB (fast, no scraping) |
| POST | `/api/marksix/refresh` | `{ "lastNDraw": 10 }` | Scrape latest draws, upsert new ones, return results |
| POST | `/api/marksix/history` | `{ "year"?, "from"?, "to"?, "limit"? }` | Query history by year, date range, or limit |

#### Response shape

```json
{
  "data": {
    "lotteryDraws": [
      {
        "id": "26/097",
        "drawDate": "2026-09-08+08:00",
        "drawResult": {
          "drawnNo": [9, 23, 28, 29, 35, 41],
          "xDrawnNo": 38
        }
      }
    ]
  },
  "source": "database",
  "totalCached": 4308,
  "lastRefresh": "2026-09-09T09:26:42.277Z"
}
```

### Client Behavior

- **First visit loads from cache** (`/api/marksix`) — instant, no scraping on page load
- "Load Older Results" appends 10 more per click via `/api/marksix/history`
- **Auto-refresh at midnight** on draw days only (Tue/Thu/Sat)
- Manual refresh button calls `/api/marksix/refresh` (scrapes + upserts)

### Service Worker

- Caches the app shell on install
- API requests (`/api/marksix*`): **network-first**, fall back to cache
- Static assets: **cache-first**, updated in background
- Cache versioned (`mark-six-v6`) — bump to force clients to fetch the new app shell

### Ball Colors

The official Mark Six ball-color grouping, applied to both main and special numbers:

| Color | Numbers |
|-------|---------|
| Red | 1, 2, 7, 8, 12, 13, 18, 19, 23, 24, 29, 30, 34, 35, 40, 45, 46 |
| Blue | 3, 4, 9, 10, 14, 15, 20, 25, 26, 31, 36, 37, 41, 42, 47, 48 |
| Green | 5, 6, 11, 16, 17, 21, 22, 27, 28, 32, 33, 38, 39, 43, 44, 49 |

The special number renders with a `+` prefix and a red ring border to distinguish it from the 6 main numbers.

---

## Supabase Setup (storage)

1. Create a project at [supabase.com](https://supabase.com).
2. Copy `.env.example` to `.env` and fill in your values:

   ```
   SUPABASE_URL=https://<your-project>.supabase.co
   SUPABASE_KEY=your-publishable-key
   PORT=3000
   ```

3. Open the **SQL Editor** in your Supabase dashboard and run the entire contents of `supabase-schema.sql` (creates the `draws` and `meta` tables plus RLS policies).
4. Start the server. If `draws` is empty, the server auto-fills ~4,300 historical draws from GitHub on first run.

> The `.env` file is git-ignored — never commit your keys.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SUPABASE_URL` | — | Supabase project URL (required) |
| `SUPABASE_KEY` | — | Supabase publishable/anon key (required) |
| `PORT` | `3000` | Server port |

---

## Testing

```bash
npm test            # Run all tests once
npm run test:watch  # Watch mode
```

55 tests across 4 test files cover parsers, DB operations, API endpoints, and draw-day logic. The suite uses in-memory SQLite + fixtures, so it runs offline without a Supabase connection.

---

## Installation as a PWA

Open the deployed URL (or local `http://<your-ip>:3000`) on your phone, then:

- **Android (Chrome):** menu → "Add to Home screen"
- **iPhone (Safari):** Share → "Add to Home Screen"

HTTPS is required for the install prompt — the Render deployment provides that automatically.

---

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for deploying to **Render** (including environment variables and the Blueprint) and migrating data into Supabase.

---

## Dependencies

| Package | Purpose |
|---------|---------|
| express | HTTP server |
| @supabase/supabase-js | Supabase client (async storage) |
| dotenv | Load `.env` variables |
| vitest | Test runner (dev) |
| supertest | HTTP testing (dev) |
| better-sqlite3 | SQLite (used by the offline test store) |

---

## Notes

- HKJC's official GraphQL API is IP-whitelisted and cannot be called directly from a public server.
- Historic draws (1993–2025) are immutable and preloaded from GitHub; refresh only pulls recent draws.
- Dates are stored as ISO (`YYYY-MM-DD`) and exposed with a `+08:00` offset.
- On Render's free tier the instance sleeps after ~15 min idle, so the first request after a sleep may cold-start slowly.
