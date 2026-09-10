const VERSION = "buseta-lite-v1";
const SHELL = [
  "/bus-eta/",
  "/bus-eta/index.html",
  "/bus-eta/styles.css",
  "/bus-eta/app.js",
  "/bus-eta/vendor/hk-bus-eta.esm.js",
  "/bus-eta/manifest.json",
  "/bus-eta/img/logo192.png",
  "/bus-eta/img/logo512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.method !== "GET") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      if (req.mode === "navigate") {
        const cached = await cache.match("/bus-eta/index.html");
        try {
          const fresh = await fetch(req);
          if (fresh.ok) cache.put("/bus-eta/index.html", fresh.clone());
          return fresh;
        } catch {
          return cached || fetch(req);
        }
      }
      if (url.pathname.startsWith("/bus-eta/")) {
        const cached = await cache.match(req);
        const network = fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => null);
        return cached || (await network) || new Response("", { status: 404 });
      }
      return fetch(req);
    })()
  );
});