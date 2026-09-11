# HK Bus ETA (巴士預報)

Two Hong Kong bus ETA UIs served from the Life Tool hub, sharing one data layer in this folder.

- **`/bus-eta/`** — the unmodified upstream [hkbus/hk-independent-bus-eta](https://github.com/hkbus/hk-independent-bus-eta)
  PWA (reference / full-featured app).
- **`/bus-eta-lite/`** — the home-grown, deliberately simple "lite" UI described below.

## Bus ETA (lite)

A mobile-first, vanilla-JS app with no build step, tuned for quick glance-and-leave use.

### Tabs

| Tab | Purpose |
|-----|---------|
| 路線查詢 / Route | Type a route number → direction pills → every stop with live arrival chips |
| 車站查詢 / Stop | Match a stop **name** or its bracket **code** (e.g. `TA296`), or use 附近的站 geolocation |
| 收藏路線 / Bookmark | Bookmarked routes (★ on the route detail page) |
| 收藏車站 / Stops | Bookmarked stops |

### Flows

- **Route flow** — search `271` → pick a direction → each stop shows live arrival chips that refresh every 30 s.
  Tapping a stop opens the **stop detail** ("all buses via"), listing every route serving that physical stop
  (including cross-operator variants via `stopMap`), sorted by route number ascending. Back returns to the route,
  preserving the selected direction. Tapping a route line inside the stop detail opens that route's own detail page;
  back returns to the stop, and further back unwinds to where the stop was opened from.
- **Stop flow** — type a stop name or **code** (e.g. `TA296`) to find the stop; "附近的站" uses geolocation.
  Tapping a result opens the same stop detail — navigate to any serving route from there.

### Features

- **Operator-coloured badges** — 九巴 red / 城巴 yellow-on-red / 嶼巴 blue / 綠Van green / NWFB orange; a route served
  by several operators (e.g. 170 = 九巴+城巴) gets a mixed **violet** badge, and unknown operators fall back to the
  neutral badge. The same palette colours the operator tags, the direction pills, and each stop row's operator chip.
- **Day / Night toggle** — header button, persisted in `localStorage` (`buseta-theme`); defaults to and live-follows
  `prefers-color-scheme` until the user picks a theme manually.
- **Bookmarks** — star a route or stop from its detail page; stored in `localStorage`
  (`buseta-book-routes`, `buseta-book-stops`); reopened from the two bookmark tabs.
- **Auto-refresh** — arrivals refresh every 30 s; manual refresh re-downloads the route database.
- **Offline-first** — the ~8 MB route database is cached in IndexedDB (`bus-eta-lite` / `kv`); the service worker
  caches the app shell (`buseta-lite-v19`) so the app opens instantly after the first visit.
- **EN/ZH toggle**, and batching (incremental rendering) for long stop lists.

## What's in this folder

| Item | Description |
|------|-------------|
| `build/` | The served lite app (mounted at `/bus-eta-lite/`): `index.html`, `app.js`, `styles.css`, `manifest.json`, `sw.js`, `vendor/`, `img/` |
| `build-upstream/` | Archived prebuilt bundle of the upstream app v11.2.0 (commit `cb5b1fcbed5f9f7cb14635ee29507084b9de2578`) — served at `/bus-eta/`, kept for reference |
| `LICENSE` | Upstream GPL-3.0 license (the route database logic derives from upstream's hk-bus-eta library) |

## How the hub serves it

The hub (`server.js`) mounts both folders:

```
/bus-eta       -> static files from build-upstream/ (original app)
/bus-eta-lite  -> static files from build/          (lite app)
Both: subpaths -> static, SPA fallback to each app's index.html
```

## Data layer

All data is fetched client-side; no backend.

- Route database — `hk-bus-eta` npm package (`fetchEtaDb()` -> `https://data.hkbus.app/routeFareList.min.json`,
  ~8 MB), cached in **IndexedDB** so repeat visits render instantly and work offline; refreshed when stale.
- Live arrivals — provider APIs via the library's `fetchEtas()` wrapper (KMB/CTB/NLB: `data.etabus.gov.hk` +
  `data.gov.hk` public APIs; green minibuses, MTR, light rail and ferries via the library's providers).

The library (`hk-bus-eta@3.8.2`, GPL-3.0) is bundled into `build/vendor/hk-bus-eta.esm.js` with esbuild:

```bash
npx esbuild node_modules/hk-bus-eta/esm/index.js --bundle --format=esm --minify --target=es2020 --outfile=build/vendor/hk-bus-eta.esm.js
```

### ETA database shape

`{ holidays, routeList, serviceDayMap, stopList, stopMap }`:

- `routeList` — keyed `"<no>+<serviceType>+<orig en>+<dest en>"`; each entry has `bound, co[], dest, orig, route, seq,
  serviceType, stops` (`stops.<co>` are provider stop ids, `[]` when the operator has no stops for that entry).
- `stopList` — `{ stopId: { location, name:{en,zh} } }`. Small-int ids are the unified NLB/minibus ids; the ~7.6 k
  hex keys are KMB/CTB provider stop ids.
- `stopMap` — maps provider stop ids -> `[[co, providerId], ...]` for cross-company lookups.
- The lite app builds client-side indexes after load: `routeNo -> entries`, `stopId -> rows`, and a deduped
  `uniqueStops` list (stop-name text + extracted bracket `code` are both searchable).

## License

The lite app is original code. It bundles `hk-bus-eta` (GPL-3.0) and derives stop-resolution logic from the upstream
app, both by [hkbus](https://github.com/hkbus). See [LICENSE](./LICENSE) (GPL-3.0) and the upstream repo:
https://github.com/hkbus/hk-independent-bus-eta