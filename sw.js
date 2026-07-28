/* dreh-das-rad service worker — bump CACHE on every deploy so clients update cleanly */
'use strict';

var CACHE = 'dreh-das-rad-v2';
var ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/wheel.js',
  './js/i18n.js',
  './js/vendor/qrcode.js',
  './js/vendor/qrcode_UTF8.js',
  './js/vendor/count.js',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE) { return caches.delete(key); }
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') { return; }

  // pages: network first (fresh HTML), cache as offline fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(function () {
        return caches.match('./index.html');
      })
    );
    return;
  }

  // assets: stale-while-revalidate — serve the cache instantly, refresh it in the
  // background so a deploy without a CACHE bump still reaches clients on their next visit
  event.respondWith(
    caches.match(req).then(function (hit) {
      var fetched = fetch(req).then(function (res) {
        if (res.ok && new URL(req.url).origin === self.location.origin) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      });
      if (hit) {
        event.waitUntil(fetched.catch(function () { /* offline: keep the cached copy */ }));
        return hit;
      }
      return fetched;
    })
  );
});
