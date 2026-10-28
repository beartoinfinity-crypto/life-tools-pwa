# CONTEXT — Mark Six PWA repo (dev handoff)

This file is an agent/readme-style snapshot for whoever works on this
repo next. It intentionally uses **ASCII only** so it can be read,
edited, and committed over byte-lossy channels without corruption.

## What this repo is

A single Vercel-hosted hub that serves several independently-authored
mini PWA apps, each under `apps/<name>/` and each mounted at its own
URL path. Shared infra lives at the repo root:

- `server.js` — Express app that mounts every app and the API.
- `api/index.js` — Supabase-backed data layer (draws, routes, music).
- `render.yaml` / `vercel.json` — hosting config.
- `db.js` (root) — Supabase client + schema bootstrap helpers.

## Apps (current build state at HEAD)

Each app is an authored PWA with its own `index.html`, `styles.css`,
`sw.js` (service worker) and `manifest.json`, cached offline.

| App dir              | SW cache          | In-page badge (build)      |
|-----------------------|-------------------|----------------------------|
| public/ (hub)         | life-tool-hub-v4  | v1.4 build 202609291603    |
| apps/traffic-news     | traffic-news-v15  | v1.8 build 202610270759    |
| apps/mark-six         | mark-six-v16      | v1.8 build 202610050754    |
| apps/music-trend      | music-trend-v36   | v1.8 build 202609291603    |
| apps/hk-bus-eta/build | buseta-lite-v32   | v1.12 build 202610270759   |

> `apps/hk-bus-eta/` holds both: `build-upstream/` and `LICENSE` are
> the vendored upstream PWA (never hand-edit them), while `build/` is
> this repo's authored lite UI served at `/bus-eta-lite/` -- it has
> its own `index.html`/`sw.js`/`styles.css`, is SW-cached, and is
> versioned/badged in the table above like every other authored app.

## Version badge convention (per app)

Every authored app shows its own version + build number inside the
`<h1>` header:

```html
<h1>TITLE<span class="app-ver">v1.6 build 202609291603</span></h1>
```

Rules:
1. Version tracks the app's shipped feature batch (`v1.0`, `v1.3`, ...).
2. Build number is the **pinned UTC timestamp** of the commit that ships
   that app's badge (format `yyyyMMddHHmm`, UTC), set via
   `$env:GIT_AUTHOR_DATE` / `$env:GIT_COMMITTER_DATE` so the badge and
   the commit agree byte-for-byte.
3. Apps that ship together in one commit share one build number; an app
   shipped on its own gets the commit's time to itself, and untouched
   apps keep their previous build. The `-vN` cache versions advance
   independently per app, whenever that app's shell changes.
4. The SW precaches `index.html` (where the badge lives), so the badge
   build and the `-vN` bump must land in the same commit (see below).

## Service worker cache bump rule (must be same commit as badge)

`sw.js` in each app begins with `var CACHE_NAME = '...-vN';`
(bus-eta-lite uses `const VERSION = 'buseta-lite-vN';` instead). Because
the SW precaches `index.html` and `styles.css`, any change to those two
files **must ship in the same commit as a `CACHE_NAME` version bump**
(or the new badge never reaches clients). In the table above, the
badge build and the `-vN` bump landed together in one pinned commit.

## Editing rule (important — had past corruption)

This repo was repeatedly corrupted when CJK (Chinese) filenames or
content were rewritten through byte-lossy tool channels that re-encode
UTF-8 incorrectly. Guardrails for future edits:

- Keep `oldString`/`newString` for `index.html`, `styles.css`, `sw.js`
  edits **pure ASCII**. Anchor `music-trend`'s `<h1>` badge on the
  ASCII `</h1>` (its title text is CJK; never type the CJK).
- `apps/mark-six/index.html` is pure ASCII (badge anchor `<h1>Mark
  Six</h1>`).
- For CSS, append only ASCII rules; verify file byte-count + repo
  byte-identity via git (`git show HEAD:...`, compare `HEAD` vs
  `@{u}`) after every commit.

## Verifying a pushed state

```bash
git rev-parse --short HEAD
git rev-parse --short '@{u}'
git status --porcelain
git show HEAD:apps/<name>/index.html | Select-String 'app-ver'
git show HEAD:apps/<name>/sw.js   # first line = CACHE_NAME
# hub (dashboard) lives at public/, not apps/<name>/:
git show HEAD:public/index.html | Select-String 'app-ver'
git show HEAD:public/sw.js        # first line = life-tool-hub-vN
# bus-eta-lite differs: apps/hk-bus-eta/build/, VERSION is on line 2
```

Healthy end-state = `HEAD` equals `@{u}`, porcelain is empty, and the
committed badge matches the committed sw bump.

## Deployment

See README.md (full walkthrough) and DEPLOYMENT.md. Briefly: host on
Vercel, Supabase for storage, `render/vercel` config at root. After a
deploy with a sw bump, hard-refresh clients (or clear the service
worker) once so the new precache is fetched.

## Recent work (this session)

All of this is committed and pushed (HEAD == origin/master). Details
live in the individual commits; this is just the map.

- **mark-six** (v1.8, `mark-six-v16`): honesty disclaimer under the
  Smart Pick generator + a sixth `contrarian` strategy. See issue #1
  (closed) and the commit messages for `5357218`.
- **bus-eta-lite** (v1.8..v1.12, `buseta-lite-v32`): operator-split
  route search rows; next-arrival-first chips; silent 30s refresh
  pooled to <=6 fetches with no-op churn skip; ETA display-format
  toggle (minutes / exact time / both, persisted in
  `localStorage['buseta-eta-fmt']`); adaptive refresh (10s while the
  next bus is within 3 minutes); `content-visibility` on stop cards.
  Commits: `a50a54b`, `7ed19c7`, `0676545`, `f6e154f`, `adcb56f`.
- **traffic-news** (v1.7..v1.8, `traffic-news-v15`): incident merge
  (same location + category within 60 min => one card, multi-source
  badges, expanded view keeps member details); active-incident summary
  band; 150ms search debounce; aria-live moved to the status line;
  30s poll + 15s relative-time ticker; `content-visibility` on cards.
  Commits: `bf7e239`, `adcb56f`.
- **Tests** now span 15 files / 347 cases (hub + mark-six +
  hk-bus-eta + traffic-news + music-trend), run with `npx vitest run`.

## Notes for the next agent

- **Vercel deploys can lag or miss a push.** Git may be at HEAD while
  the live site still serves an older badge. Do not trust the deployed
  badge as proof of the push; verify with `git rev-parse HEAD` +
  `git ls-remote origin master`. Trigger/redeploy from the Vercel
  dashboard when a build is missing.
- **Traffic-news has no `apps/traffic-news/README.md`** -- the main
  `README.md` section describes it. `apps/hk-bus-eta/README.md` exists
  and is the data-layer + features reference for bus-eta-lite.
- **bus-eta-lite** auto-refresh cadence is adaptive (10s / 30s) and
  re-schedules itself whenever ETA data lands (`state.rescheduleEta`).
  Tests that fake timers for it must also fake the window `Date`
  (see `apps/hk-bus-eta/test/eta.test.js`).
- **`marksix.md` at the repo root is an old, already-implemented spec**
  (v1.7 Smart Pick). It is intentionally left untracked; do not commit
  it unless asked.
- **Known flake**: the traffic-news ticker test occasionally fails in
  a full run under load (fake-timer + jsdom `Date` interaction). It
  passes reliably in isolation; re-run before committing.
- Repo-level gotchas (ASCII-only edits, badge/sw same-commit rule,
  verification commands) are in the sections above -- read them before
  touching an app's shell files.
