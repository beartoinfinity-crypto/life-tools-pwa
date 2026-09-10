const BASE = "/bus-eta-lite/";
const VERSION = "buseta-lite-v16";
const SHELL = [
  BASE,
  BASE + "index.html",
  BASE + "styles.css",
  BASE + "app.js",
  BASE + "vendor/hk-bus-eta.esm.js",
  BASE + "manifest.json",
  BASE + "img/logo192.png",
  BASE + "img/logo512.png",
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
        const cached = await cache.match("/bus-eta-lite/index.html");
        try {
          const fresh = await fetch(req);
          if (fresh.ok) cache.put("/bus-eta-lite/index.html", fresh.clone());
          return fresh;
        } catch {
          return cached || fetch(req);
        }
      }
      if (url.pathname.startsWith("/bus-eta-lite/")) {
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