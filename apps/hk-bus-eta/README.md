# HK Bus ETA (巴士預報)

A focused, mobile-first bus ETA web app for Hong Kong, served from the Life Tool hub at **`/bus-eta/`**.

Replaces the upstream [hkbus/hk-independent-bus-eta](https://github.com/hkbus/hk-independent-bus-eta) PWA with a
deliberately simple home-grown UI built around exactly two flows:

1. **路線查詢 / Route** — type a route number (e.g. `1A`, `286X`, `A12`), pick a direction, see every stop with live
   arrival chips (tap a time for details).
2. **車站查詢 / Stop** — type a stop name (or use "附近的站" geolocation) to see *every route* serving that stop with
   live arrivals.

Both views auto-refresh every 30 s, plus a manual refresh that re-downloads the route database.

## What's in this folder

| Item | Description |
|------|-------------|
| `build/` | The served app (this is what the hub mounts): `index.html`, `app.js`, `styles.css`, `manifest.json`, `sw.js`, `vendor/`, `img/` |
| `build-upstream/` | Archived prebuilt bundle of the upstream app v11.2.0 (commit `cb5b1fcbed5f9f7cb14635ee29507084b9de2578`) — kept for reference, **not served** |
| `LICENSE` | Upstream GPL-3.0 license (the route database logic derives from upstream's hk-bus-eta library) |

## How the hub serves it

The hub (`server.js`) mounts this folder:

```
/bus-eta          -> 302 /bus-eta/
/bus-eta/*        -> static files from build/
/bus-eta/<path>   -> SPA fallback to build/index.html
```

## Data layer

All data is fetched client-side; no backend:

- Route database — `hk-bus-eta` npm package (`fetchEtaDb()` -> `https://data.hkbus.app/routeFareList.min.json`,
  ~8 MB). Cached in **IndexedDB** so repeat visits render instantly and work offline; refreshed on launch when stale.
- Live arrivals — provider APIs via the library's `fetchEtas()` wrapper (KMB/CTB/NLB: `data.etabus.gov.hk` +
  `data.gov.hk` public APIs; green minibuses, MTR, light rail and ferries via the library's providers).

The library (`hk-bus-eta@3.8.2`, GPL-3.0, MIT for the source? — see its own license) is bundled into
`build/vendor/hk-bus-eta.esm.js` with esbuild:

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
- "Routes serving a stop": precomputed client-side by scanning `routeList` into a `stopId -> rows` index after load.

## License

The app is original code. It bundles `hk-bus-eta` (GPL-3.0) and derives stop-resolution logic from the upstream
app, both by [hkbus](https://github.com/hkbus). See [LICENSE](./LICENSE) (GPL-3.0) and the upstream repo:
https://github.com/hkbus/hk-independent-bus-eta