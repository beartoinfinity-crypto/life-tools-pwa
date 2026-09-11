# Life Tool

A hub of handy Progressive Web Apps (PWAs), served by one Express app and deployed to Vercel (with a legacy Render host). Each app lives under `apps/`, is mounted at its own URL path, and shares the same Supabase storage stack.

- **Live dashboard:** https://mark-six-pwa.onrender.com (Render — legacy host)
- **Repo:** https://github.com/beartoinfinity-crypto/mark-six-pwa
- **Hosting:** Vercel (serverless Functions + CDN static), legacy Render single service
- **Storage:** Supabase (PostgreSQL)

## Apps

| App | URL | Description |
|-----|-----|-------------|
| **Mark Six** | `/mark-six/` | Hong Kong Mark Six lottery results: latest draws, full history, special numbers, daily auto-refresh |
| **HK Bus ETA (original)** | `/bus-eta/` | Archived upstream PWA (hkbus/hk-independent-bus-eta) — full-featured, mounted unmodified |
| **Bus ETA (lite)** | `/bus-eta-lite/` | Home-grown simple ETA UI — route & stop search, bookmarks, day/night theme, operator-coloured badges; data via the bundled [hk-bus-eta](https://www.npmjs.com/package/hk-bus-eta) library (GPL-3.0) |
| **Traffic News** | `/traffic-news/` | Latest HK traffic incidents from Routejam (路暢), cached in Supabase and refreshed every minute |

Browsing to the root (`/`) shows a launcher dashboard with a card per app. The dashboard itself has a **Dark/Light
toggle** (persisted, defaults to system), a theme-aware favicon, and the cards can be **drag-reordered** (order
persists in `localStorage`).

---

## Quick Start (local)

```bash
npm install
npm start
```

Open `http://localhost:3000` — visit `/` for the dashboard, `/mark-six/`, `/bus-eta-lite/` and `/traffic-news/`
for the apps.

> Prerequisite: a Supabase project and a `.env` file — see [Supabase Setup](#supabase-setup-storage).

---

## Project Structure

```
.
├── server.js             # Local/Render launcher: listen + start-up backfill (requires app.js)
├── app.js                # The Express app as a module (dashboard + all mounts); shared by server.js and Vercel
├── api/index.js          # Vercel serverless function: wraps app.js + lazy first-request backfill
├── build-vercel.mjs      # Assembles vercel-out/ (dashboard + static apps) for Vercel
├── vercel.json           # Vercel config: build/output dir + catch-all rewrite to /api/index
├── public/               # Dashboard (served at /)
│   ├── index.html
│   ├── styles.css
│   ├── app.js            # Renders launcher cards + theme toggle + drag-reorder (add new apps here)
│   ├── icon-light.svg    # Theme-aware favicon (light)
│   └── icon-dark.svg     # Theme-aware favicon (dark)
├── apps/
│   └── mark-six/         # Mark Six PWA (mounted at /mark-six/)
│       ├── server.js          # Express app (module) + ensureInitialData()
│       ├── supabase-db.js     # Supabase client + store operations
│       ├── supabase-schema.sql # SQL: draws/meta/traffic_news tables + RLS (run in Supabase SQL editor)
│       ├── supabase-revert.sql # SQL: drops everything the schema creates (undo an accidental run)
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
│   └── hk-bus-eta/        # HK Bus ETA apps (mounted at /bus-eta/, /bus-eta-lite/)
│       ├── build/             # Lite ETA UI (served at /bus-eta-lite/): app.js + bundled hk-bus-eta library
│       ├── build-upstream/    # Archived upstream PWA (served at /bus-eta/, not from this dir)
│       ├── README.md          # Attribution + data-layer notes
│       └── LICENSE            # GPL-3.0 (upstream license, required)
│   └── traffic-news/      # Traffic News PWA (mounted at /traffic-news/)
│       ├── parser.js          # Parses news.routejam.com accordion HTML (date/category/location/detail/coords)
│       ├── server.js          # Express app: static PWA + POST /api/news(+refresh) + refreshTrafficNews()
│       ├── index.html / app.js / styles.css / manifest.json / sw.js / icons/  # The PWA itself
│       └── test/              # Parser tests (fixture HTML)
├── render.yaml           # Render Blueprint config
├── package.json
├── .env.example
└── vitest.config.mjs
```

### Adding a new app

1. Create `apps/<name>/` with a `server.js` that exports `{ app, ensureInitialData? }` (an Express app plus an optional startup hook) — or, for a static-only PWA, drop its build output in a folder and serve it with `express.static` + a SPA fallback (see the `bus-eta` mount in `app.js`).
2. In the hub `app.js`, mount it (with an exact-match `/name` → `/name/` redirect for PWAs that need one): `app.use('/<name>', require('./apps/<name>/server').app);`
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

3. Open the **SQL Editor** and run `apps/mark-six/supabase-schema.sql` (creates `draws`, `meta` and `traffic_news`
   tables plus RLS policies).
4. Start the server. If `draws` is empty, the Mark Six app auto-fills ~4,300 historical draws from GitHub.

> The `.env` file is git-ignored — never commit your keys.

**Schema (Supabase)** — `draws` and `meta` above, plus the traffic-news cache table:

```sql
CREATE TABLE traffic_news (
  id        text primary key,      -- routejam item id (md5 / RD# / IN- / DS-)
  posted_at timestamptz,          -- incident time (HK, +08:00)
  category  text,                 -- e.g. "道路事故-交通意外"
  status    text,                 -- "最新情況" or "完結"
  location  text,
  detail    text,
  source    text,
  lat       double precision,     -- map marker (null when routejam has none)
  lng       double precision,
  created_at timestamptz not null default now()
);
```

To undo a schema run (e.g. on the wrong project), use `apps/mark-six/supabase-revert.sql` — it drops all three
tables and their policies.

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

## HK Bus ETA apps

Two bus UIs share one data layer (`apps/hk-bus-eta/`):

### `/bus-eta/` — original (upstream) PWA

The unmodified prebuilt [hkbus/hk-independent-bus-eta](https://github.com/hkbus/hk-independent-bus-eta) v11.2.0,
archived in `apps/hk-bus-eta/build-upstream/` and served at `/bus-eta/`. Full-featured (maps, saved stops, theme,
filtering) — kept as the "reference" app.

### `/bus-eta-lite/` — lite UI

A mobile-first, vanilla-JS re-implementation tuned for quick glance-and-leave use. Tabs:

| Tab | Purpose |
|-----|---------|
| 路線查詢 / Route | Type a route number (e.g. `1A`, `286X`, `A12`) → direction pills → every stop with live arrival chips; **tap a stop** to see *all routes via it*, and **tap a route** in that list to jump to its own detail |
| 車站查詢 / Stop | Fuzzy-like match on stop **name** *or* **code** (e.g. `TA296`) — the code in the bracket is searchable; "附近的站" geolocation also available |
| 收藏路線 / Bookmark | All bookmarked routes (★ on the route detail page) |
| 收藏車站 / Stops | All bookmarked stops |

Other features:

- **Operator-coloured badges** — route numbers render in the operator's colour: 九巴 red, 城巴 yellow-on-red, 嶼巴 blue, 綠Van green, NWFB orange; a route served by several operators (e.g. 170) gets a mixed violet badge. The same palette also colours the operator tags, the direction pills, and each stop row's operator chip.
- **Day / Night toggle** — header button, persisted in `localStorage`, follows the system preference until you choose manually (override wins over `prefers-color-scheme`).
- **Bookmarks** — star a route or stop from its detail page; stored in `localStorage`, listed under the two bookmark tabs, tap to reopen. Route bookmarks also remember the **direction** you were viewing (switching pills on a starred route updates it).
- **Auto-refresh** — live arrival chips refresh every 30 s; manual refresh re-downloads the route database.
- **Offline-first** — route database cached in IndexedDB; service worker caches the shell (`buseta-lite-v20`).
- **EN/ZH** toggle; near-black UI in night mode with corrected chip/badge colours.

Served files are in `apps/hk-bus-eta/build/` (includes the bundled `vendor/hk-bus-eta.esm.js`). The route database is
fetched client-side via the library's `fetchEtaDb()` (`https://data.hkbus.app/routeFareList.min.json`, ~8 MB, cached in
IndexedDB); live arrivals come from the provider APIs (KMB/CTB/NLB/綠Van/MTR/light rail/ferries) via `fetchEtas()`.
See `apps/hk-bus-eta/README.md` for the data-layer details.

The bundled library is GPL-3.0; the upstream LICENSE is included in `apps/hk-bus-eta/`.

---

## Traffic News (`/traffic-news/`)

A standalone PWA showing the latest Hong Kong traffic incidents from [Routejam 路暢](https://news.routejam.com/).
The browser only ever reads the Supabase cache (table `traffic_news`); routejam is scraped server-side and
upserted into Supabase, so page loads stay fast and routejam is hit at most once a minute. The app shows the
last **12 hours** of incidents with 最新/完結 badges, HK-time + relative timestamps, tap-to-expand details, a
manual refresh button and a 1-minute auto-poll; installable like the other apps (manifest + service worker).

| Method | Endpoint | Request body | Description |
|--------|----------|--------------|-------------|
| POST | `/traffic-news/api/news` | `{ "limit"?: 30, "status"?: "最新情況", "hours"?: 12 }` | Latest cached news from Supabase (default: last 12 h) |
| POST | `/traffic-news/api/news/refresh` | `{ "limit"?, "hours"? }` | Scrape routejam, upsert, return latest |

- **Refresh cadence** — on Render/local the server scrapes at boot + every 60 s (`setInterval` in `server.js`).
  On Vercel (serverless, no timers) each read kicks a background re-scrape when the cache is older than 60 s
  (stale-while-revalidate in `api/index.js`); the app's refresh button scrapes on demand.
- **Parser** — `apps/traffic-news/parser.js` reads routejam's server-rendered accordion HTML: item id, posted time
  (converted to ISO `+08:00`), category/status, location, detail, source, and map coordinates (when present).
  Covered by unit tests with a fixture page.

---

## Testing

```bash
npm test            # Run all tests once
npm run test:watch  # Watch mode
```

67 tests across 5 files under `apps/mark-six/test/` and `apps/traffic-news/test/`. The suite uses in-memory SQLite + fixtures, so it runs offline without a Supabase connection.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SUPABASE_URL` | — | Supabase project URL (required) |
| `SUPABASE_KEY` | — | Supabase publishable/anon key (required) |
| `PORT` | `3000` | Server port |

---

## Deployment

The hub runs on Render today and deploys to Vercel too.

### Vercel (preferred)

The repo is Vercel-ready — no further setup beyond the project.

1. Push the repo and import it at [vercel.com/new](https://vercel.com/new) (or run `vercel` from the CLI).
2. Framework Preset: **Other** (no build framework). The `vercel.json` sets the build command, output directory and routing.
3. Add the environment variables `SUPABASE_URL` and `SUPABASE_KEY` (same as the Render host).
4. Deploy. Nothing to configure for routing:
   - `vercel-out/` (produced by `npm run build:vercel`, runs `build-vercel.mjs`) holds the dashboard + all three static apps at their hub paths.
   - The whole Express API runs inside a single serverless function (`api/index.js`) via the catch-all rewrite in `vercel.json`. Static files are served by Vercel's CDN; anything unmatched (APIs, SPA fallbacks, `bus-eta` redirects) is handled by Express, exactly like `server.js` does locally.
   - On a fresh Supabase DB the first Mark Six data request backfills the ~4,300 historical draws once, lazily.

Local dev still works unchanged: `npm start` → `node server.js` (port 3000, auto-backfill on boot).

### Render (legacy)

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full Render + Supabase walkthrough.

---

## Notes

- The hub mounts sub-apps as Express apps; each is self-contained under `apps/`.
- On Render's free tier the instance sleeps after ~15 min idle, so the first request after an idle period may cold-start slowly.
- `marksix.db` (SQLite) is no longer used in production — storage is Supabase only.