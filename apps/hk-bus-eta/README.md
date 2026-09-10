# HK Bus ETA (香港巴士預報)

Hong Kong bus ETA PWA (KMB / LWB / CTB / NLB / MTR Bus, green minibus, light rail and MTR), served from the Life Tool hub at **`/bus-eta/`**.

This is the prebuilt static bundle of [hkbus/hk-independent-bus-eta](https://github.com/hkbus/hk-independent-bus-eta)
**v11.2.0** (commit `cb5b1fcbed5f9f7cb14635ee29507084b9de2578`), built with `base: "/bus-eta/"`, included here for self-hosting.

## Build inputs

| Item | Value |
|------|-------|
| Upstream repo | https://github.com/hkbus/hk-independent-bus-eta (GPL-3.0) |
| Version | 11.2.0 |
| Upstream commit | `cb5b1fcbed5f9f7cb14635ee29507084b9de2578` |
| This build | `vite build` with `base: "/bus-eta/"` (see #subpath-bundling) |

## What's in this folder

- `build/` — the production bundle to be served (this is what the hub mounts)
- `LICENSE` — upstream GPL-3.0 license (required for redistribution)

## How the hub serves it

The hub (`server.js`) mounts this folder:

```
/bus-eta          -> 302 /bus-eta/
/bus-eta/*        -> static files from build/
/bus-eta/<route>  -> SPA fallback to build/index.html  (client routing, e.g. /bus-eta/zh/route/1A)
```

## Subpath bundling

The upstream app is hardcoded for root hosting. To self-host under `/bus-eta/`
the following changes were made to the source before building:

- `vite.config.ts`: `base: "/bus-eta/"`; PWA manifest `scope: "/bus-eta/"`; workbox runtime-cache patterns use `/bus-eta/...` literals
- `src/App.tsx`: `<BrowserRouter basename="/bus-eta">`
- `src/db.ts`: `fetch("/schema-version.txt")` -> `${import.meta.env.BASE_URL}schema-version.txt`
- `src/pages/SettingsPage.tsx`, `src/components/settings/InstallDialog.tsx`,
  `src/components/map/maplibre/BaseMap.tsx`, `RouteMap.tsx`, `SearchMap.tsx`,
  `src/components/layout/Header.tsx`, `src/components/emotion/EmotionTabbar.tsx`,
  `src/pages/BookmarkedStopPage.tsx`: absolute `/img/...`, `/sw.js` refs -> `import.meta.env.BASE_URL` prefixed
- `vite-plugin-eslint` was removed from the build so `vite build` doesn't fail on lint warnings

## Rebuilding

```bash
git clone https://github.com/hkbus/hk-independent-bus-eta.git
cd hk-independent-bus-eta
npm install --legacy-peer-deps    # upstream uses yarn; npm needs the flag
# apply the #subpath-bundling changes above (mirror of this repo's git history)
npx vite build                    # optional pre-step: tsc && vite build
# output lands in build/  ->  copy to apps/hk-bus-eta/build
```

Data at runtime is fetched client-side from `data.hkbus.app` / `data.gov.hk` (public CORS APIs) — no backend needed.

## License

GPL-3.0. See [LICENSE](./LICENSE). Upstream project: https://github.com/hkbus/hk-independent-bus-eta