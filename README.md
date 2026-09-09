# Mark Six PWA

A Progressive Web App that displays Hong Kong Mark Six lottery results, with daily auto-refresh on draw days (Tue/Thu/Sat) and installable on iPhone/Android home screens.

## Quick Start

```bash
cd mark-six-pwa
npm install
npm start

cd mark-six-pwa && npm start
```

Open `http://localhost:3000` in browser.

## Supabase Setup (storage)

Historical results are stored in **Supabase** (PostgreSQL) instead of local SQLite.

1. Create a project at [supabase.com](https://supabase.com)
2. Copy the `.env.example` to `.env` and fill in your project URL and publishable key:

   ```
   SUPABASE_URL=https://<your-project>.supabase.co
   SUPABASE_KEY=your-publishable-key
   ```

3. Open the **SQL Editor** in your Supabase dashboard and run the contents of
   `supabase-schema.sql` to create the `draws` and `meta` tables (with RLS policies).

4. Start the server. If the DB is empty it auto-fills from GitHub on first run.

> The `.env` file is git-ignored — never commit your keys.

## Project Structure

```
mark-six-pwa/
├── server.js          # Entry point — Express + Supabase storage
├── supabase-db.js     — Supabase client + store operations
├── supabase-schema.sql — SQL to create tables in Supabase SQL Editor
├── parsers.js         — HTML/JSON parsers for each data source
├── app.js             # Client-side logic
├── sw.js              # Service worker (offline caching)
├── index.html         # Main page
├── styles.css         # Mobile-first responsive styles
├── manifest.json      # PWA manifest
├── icons/icon.svg     # App icon
├── package.json       # Dependencies
├── data/
│   └── marksix.db     # SQLite database (created at runtime)
└── test/
    ├── parsers.test.js  # 21 tests — scraper parsers
    ├── db.test.js       # 15 tests — DB operations
    ├── api.test.js      # 8 tests — API endpoints
    ├── draw-day.test.js # 11 tests — draw-day logic
    └── fixtures/        # Test HTML/JSON fixtures
```

## Architecture

### Data Flow

```
lotteryextreme.com ──┐
lottery.hk ──────────┼──▶ scrapers.js ──▶ parsers.js ──▶ db.js ──▶ api.js ──▶ app.js ──▶ Browser
GitHub JSON ─────────┘
```

### Data Sources

| Source | Coverage | Used for |
|--------|----------|----------|
| lotteryextreme.com | Latest ~20 draws | Daily refresh (append-only) |
| lottery.hk | All years (1993–now) | Backfill missing years |
| GitHub JSON | 1993–2025 (~4288 draws) | Initial DB load when empty |

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/marksix?lastNDraw=N` | Get latest N draws |
| GET | `/api/marksix/history?year=&from=&to=&limit=` | Query by year, range, or limit |
| POST | `/api/marksix/refresh` | Scrape latest draw, append if new |

#### Response Shape

```json
{
  "data": {
    "lotteryDraws": [
      {
        "id": "26/089",
        "drawDate": "2026-08-15+08:00",
        "drawResult": {
          "drawnNo": [4, 16, 25, 27, 28, 33],
          "xDrawnNo": 14
        }
      }
    ]
  },
  "source": "database",
  "totalCached": 4308
}
```

### Database

SQLite with WAL mode. Schema:

```sql
CREATE TABLE draws (
  draw TEXT PRIMARY KEY,       -- "26/089"
  date TEXT NOT NULL,          -- "2026-08-15" (ISO)
  numbers TEXT NOT NULL,       -- JSON: [4,16,25,27,28,33]
  special INTEGER,             -- 14
  source TEXT,                 -- "lotteryextreme", "lottery.hk", "github"
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

### Client

- Loads latest 10 draws on page load
- "Load Older Results" appends 10 more per click
- **Auto-refresh at midnight** — only on draw days (Tue/Thu/Sat)
- Manual refresh button works any time

### Service Worker

- Caches app shell on install
- API requests: network-first, falls back to cache
- Static assets: cache-first, updates in background

### Ball Colors

| Color | Numbers |
|-------|---------|
| Red | 1, 2, 7, 8, 12, 13, 18, 19, 23, 24, 29, 30, 34, 35, 40, 45, 46 |
| Blue | 3, 4, 9, 10, 14, 15, 20, 25, 26, 31, 36, 37, 41, 42, 47, 48 |
| Green | 5, 6, 11, 16, 17, 21, 22, 27, 28, 32, 33, 38, 39, 43, 44, 49 |

Special number displays with `+` prefix and a red ring border.

## Testing

```bash
npm test          # Run all tests
npm run test:watch  # Watch mode
```

55 tests across 4 test files covering parsers, DB operations, API endpoints, and draw-day logic.

## Configuration

| Env Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |

Database path: `data/marksix.db` (auto-created on first run).

## Install as PWA

### Android (Chrome)
1. Open `http://<your-ip>:3000` on same WiFi
2. Tap menu → "Add to Home screen"

### iPhone (Safari)
1. Open `http://<your-ip>:3000`
2. Tap Share → "Add to Home Screen"

### Standalone on Android (no server)
```bash
pkg install nodejs
cd mark-six-pwa && npm install && node server.js
```

## Dependencies

| Package | Purpose |
|---------|---------|
| express | HTTP server |
| better-sqlite3 | SQLite (native module) |
| vitest | Test runner (dev) |
| supertest | HTTP testing (dev) |

## Notes

- HKJC GraphQL API is IP-whitelisted — cannot be used directly
- All historical data persisted in SQLite, never deleted
- Dates stored as ISO (`YYYY-MM-DD`), converted to `+08:00` for API responses
