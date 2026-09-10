# Life Tool

A hub of handy Progressive Web Apps (PWAs), served from a single Express server and deployed to Render. Each app lives under `apps/`, is mounted at its own URL path, and shares the same Supabase storage stack.

- **Live dashboard:** https://mark-six-pwa.onrender.com
- **Repo:** https://github.com/beartoinfinity-crypto/mark-six-pwa
- **Hosting:** Render (Node.js, single service)
- **Storage:** Supabase (PostgreSQL)

## Apps

| App | URL | Description |
|-----|-----|-------------|
| **Mark Six** | `/mark-six/` | Hong Kong Mark Six lottery results: latest draws, full history, special numbers, daily auto-refresh |
| **HK Bus ETA** | `/bus-eta/` | Hong Kong real-time bus/minibus ETA — search by **route number** or by **bus stop** ("all buses via"), auto-refresh every 30 s, offline-capable; data from `data.hkbus.app` / `data.gov.hk` via the bundled [hk-bus-eta](https://www.npmjs.com/package/hk-bus-eta) library (GPL-3.0) |

Browsing to the root (`/`) shows a launcher dashboard with a card for each app.

---

## Quick Start (local)

```bash
npm install
npm start
```

Open `http://localhost:3000` — visit `/` for the dashboard and `/mark-six/` for the Mark Six app.

> Prerequisite: a Supabase project and a `.env` file — see [Supabase Setup](#supabase-setup-storage).

---

## Project Structure

```
.
├── server.js             # Hub server: dashboard + mounts each app
├── public/               # Dashboard (served at /)
│   ├── index.html
│   ├── styles.css
│   └── app.js            # Renders launcher cards (add new apps here)
├── apps/
│   └── mark-six/         # Mark Six PWA (mounted at /mark-six/)
│       ├── server.js          # Express app (module) + ensureInitialData()
│       ├── supabase-db.js     # Supabase client + store operations
│       ├── supabase-schema.sql # SQL: tables + RLS for Supabase
│       ├── parsers.js         # HTML/JSON parsers for data sources
│       ├── api.js             # Modular Express app (used by tests)
│       ├── db.js              # In-memory SQLite store (used by tests)
│       ├── scrapers.js        # HTTP fetch + scrape orchestrators
│       ├── draw-day.js        # Draw-day logic (Tue/Thu/Sat)
│       ├── index.html         # App page
│       ├── app.js             # Client-side logic
│       ├── styles.css
│       ├── manifest.json      # PWA manifest (scope /mark-six/)
│       ├── sw.js              # Service worker (offline caching)
│       ├── icons/icon.svg
│       └── test/              # Vitest suite (55 tests) + fixtures
│   └── hk-bus-eta/        # HK Bus ETA app (mounted at /bus-eta/)
│       ├── build/             # Lite ETA UI (served): app.js + bundled hk-bus-eta library
│       ├── build-upstream/    # Archived upstream PWA (not served)
│       ├── README.md          # Attribution + data-layer notes
│       └── LICENSE            # GPL-3.0 (upstream license, required)
├── render.yaml           # Render Blueprint config
├── package.json
├── .env.example
└── vitest.config.mjs
```

### Adding a new app

1. Create `apps/<name>/` with a `server.js` that exports `{ app, ensureInitialData? }` (an Express app plus an optional startup hook) — or, for a static-only PWA, drop its build output in a folder and serve it with `express.static` + a SPA fallback (see the `bus-eta` mount in `server.js`).
2. In the hub `server.js`, mount it: `app.use('/<name>', require('./apps/<name>/server').app);`
3. Add a card to `public/app.js` under `APPS`.
4. Client code should use an `API_BASE` prefix matching its mount path (see `apps/mark-six/app.js`).

---

## Supabase Setup (storage)

1. Create a project at [supabase.com](https://supabase.com).
2. Copy `.env.example` to `.env` and fill in your values:

   ```
   SUPABASE_URL=https://<your-project>.supabase.co
   SUPABASE_KEY=your-publishable-key
   PORT=3000
   ```

3. Open the **SQL Editor** and run `apps/mark-six/supabase-schema.sql` (creates `draws` and `meta` tables plus RLS policies).
4. Start the server. If `draws` is empty, the Mark Six app auto-fills ~4,300 historical draws from GitHub.

> The `.env` file is git-ignored — never commit your keys.

**Schema (Supabase):**

```sql
CREATE TABLE draws (
  id       bigint generated always as identity primary key,
  draw     text not null unique,   -- e.g. "26/097"
  date     text not null,          -- ISO "2026-09-08"
  numbers  text not null,          -- JSON: [9,23,28,29,35,41]
  special  integer,                -- the special number (e.g. 38)
  source   text,
  created_at timestamptz not null default now()
);

CREATE TABLE meta (
  key   text primary key,
  value text,
  updated_at timestamptz not null default now()
);
```

---

## Mark Six app details

### Data sources

| Source | Coverage | Used for |
|--------|----------|----------|
| lotteryextreme.com | Latest ~20 draws | Daily refresh (append-only), incl. special numbers |
| GitHub JSON | 1993–2025 (~4,288 draws) | Initial / historical backfill when empty |
| lottery.hk | All years | Historical backfill (bounded to current/previous year) |

### API endpoints (mounted under `/mark-six`)

| Method | Endpoint | Request body | Description |
|--------|----------|--------------|-------------|
| POST | `/mark-six/api/marksix` | `{ "lastNDraw": 10 }` | Latest N draws from DB (fast) |
| POST | `/mark-six/api/marksix/refresh` | `{ "lastNDraw": 10 }` | Scrape latest draws, upsert new, return results |
| POST | `/mark-six/api/marksix/history` | `{ "year"?, "from"?, "to"?, "limit"? }` | Query by year, range, or limit |

Response shape:

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

### Client behaviour

- First visit loads from cache (`/mark-six/api/marksix`) — no scraping on page load
- Auto-refresh at midnight on draw days only (Tue/Thu/Sat)
- Manual refresh button scrapes a fresh copy of the latest draws
- 6 main numbers + 1 **special number** (rendered with a `+` and red ring)

### Ball colours

| Colour | Numbers |
|--------|---------|
| Red | 1, 2, 7, 8, 12, 13, 18, 19, 23, 24, 29, 30, 34, 35, 40, 45, 46 |
| Blue | 3, 4, 9, 10, 14, 15, 20, 25, 26, 31, 36, 37, 41, 42, 47, 48 |
| Green | 5, 6, 11, 16, 17, 21, 22, 27, 28, 32, 33, 38, 39, 43, 44, 49 |

---

## HK Bus ETA app

`/bus-eta/` is a focused, mobile-first PWA for Hong Kong bus/minibus ETA with two flows: **search by route number**
(direction pills → every stop with live arrival chips) and **search by bus stop** (every route serving that stop).
It auto-refreshes every 30 s, has an EN/ZH toggle, and stays usable offline.

- No backend: routes come from `hk-bus-eta`'s `fetchEtaDb()` (`https://data.hkbus.app/routeFareList.min.json`, ~8 MB,
  cached in IndexedDB); live arrivals come from the provider APIs (KMB/CTB/NLB/green minibus/MTR/light rail/ferries)
  via the library's `fetchEtas()`.
- The served files live in `apps/hk-bus-eta/build/` (original `index.html` / `app.js` / `styles.css` + a bundled
  `vendor/hk-bus-eta.esm.js`); the **upstream prebuilt PWA** (hkbus/hk-independent-bus-eta v11.2.0) is archived in
  `apps/hk-bus-eta/build-upstream/` and is **not served**.
- The bundled library is GPL-3.0; the upstream LICENSE is included. See `apps/hk-bus-eta/README.md` for details.

---

## Testing

```bash
npm test            # Run all tests once
npm run test:watch  # Watch mode
```

55 tests across 4 files under `apps/mark-six/test/`. The suite uses in-memory SQLite + fixtures, so it runs offline without a Supabase connection.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SUPABASE_URL` | — | Supabase project URL (required) |
| `SUPABASE_KEY` | — | Supabase publishable/anon key (required) |
| `PORT` | `3000` | Server port |

---

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full Render + Supabase walkthrough.

---

## Notes

- The hub mounts sub-apps as Express apps; each is self-contained under `apps/`.
- On Render's free tier the instance sleeps after ~15 min idle, so the first request after an idle period may cold-start slowly.
- `marksix.db` (SQLite) is no longer used in production — storage is Supabase only.