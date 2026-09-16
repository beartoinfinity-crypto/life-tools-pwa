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
`sw.js`, service worker, and manifest, cached offline.

| App dir            | SW cache         | In-page badge (v1.0 build) |
|--------------------|------------------|----------------------------|
| apps/traffic-news  | traffic-news-v5  | v1.0 build 202609160643    |
| apps/mark-six      | mark-six-v7      | v1.0 build 202609160744    |
| apps/music-trend   | music-trend-v17  | v1.0 build 202609160749    |

> `apps/hk-bus-eta/` is **not** an authored app in this repo. It holds
> `LICENSE`, `README.md`, `build-upstream/` and `build/` — vendored
> upstream build outputs of an external project. There is no authored
> `index.html`/`sw.js`/`styles.css` at its app root, so it is **not**
> versioned/badged herehare. Do not hand-edit the vendored build.

## Version badge convention (per app)

Every authored app shows its own version + build number inside the
`<h1>` header:

```html
<h1>TITLE<span class="app-ver">v1.0 build 202609160643</span></h1>
```

Rules:
1. Version is `v1.0`.
2. Build number is the **app-specific pinned UTC timestamp** of the
   commit that ships that app's badge (format `yyyyMMddHHmm`, UTC).
3. Each app has its **own** build number. Apps are committed at
   different times, so the numbers are naturally different — they are
   deliberately **not** synchronized across apps.
4. The build number in the badge must equal the **commit UTC time**
   of that app's own commit (byte-for-byte), because the SW precaches
   the HTML the badge lives in.

## Service worker cache bump rule (must be same commit as badge)

`sw.js` in each app begins with `var CACHE_NAME = '...-vN';`. Because
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
```

Healthy end-state = `HEAD` equals `@{u}`, porcelain is empty, and the
committed badge matches the committed sw bump.

## Deployment

See README.md (full walkthrough) and DEPLOYMENT.md. Briefly: host on
Vercel, Supabase for storage, `render/vercel` config at root. After a
deploy with a sw bump, hard-refresh clients (or clear the service
worker) once so the new precache is fetched.
