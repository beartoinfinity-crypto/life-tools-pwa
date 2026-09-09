var CACHE_NAME = 'mark-six-v5';
var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon.svg'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(ASSETS); })
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

  if (url.pathname === '/api/marksix' || url.pathname === '/api/marksix/refresh') {
    event.respondWith(
      fetch(event.request).then(function (response) {
        var cloned = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, cloned); });
        return response;
      }).catch(function () {
        return caches.match(event.request);
      })
    );
    return;
  }

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
