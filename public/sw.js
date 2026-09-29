var CACHE_NAME = 'life-tool-hub-v2';
var SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-light.svg',
  './icon-dark.svg'
];

// Only the hub shell is handled here. Sub-apps (/mark-six/, /traffic-news/, ...)
// register their own workers with narrower scopes, which take precedence for
// their clients - but we also never touch their URLs so they are never
// intercepted from this worker.
var SHELL_PATHS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-light.svg',
  '/icon-dark.svg'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(SHELL); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (SHELL_PATHS.indexOf(url.pathname) === -1) return;

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      var fetched = fetch(event.request).then(function (response) {
        if (response && response.status === 200) {
          var cloned = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, cloned); });
        }
        return response;
      }).catch(function () { return cached; });

      return cached || fetched;
    })
  );
});
