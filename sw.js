const CACHE_NAME = 'psk-transport-pages-shell-v6.0.0';
const APP_SHELL = [
  './',
  './index.html',
  './assets/styles.css',
  './assets/app.js',
  './manifest.webmanifest'
];

const LIVE_API_HOSTS = new Set([
  'data.etabus.gov.hk',
  'data.etagmb.gov.hk',
  'rt.data.gov.hk',
  'api.allorigins.win',
  'api.codetabs.com',
  'corsproxy.io'
]);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // ETA and route API responses must stay live. Let the app's own short TTL cache
  // handle request deduplication; never persist these responses in the SW cache.
  if (LIVE_API_HOSTS.has(url.hostname)) return;

  // Cache health metadata must always reflect the latest GitHub Action result.
  // Do not keep transport-meta.json in the Service Worker cache.
  if (url.origin === self.location.origin && url.pathname.endsWith('/data/transport-meta.json')) return;

  // Daily transport mirror files use a ?day=YYYY-MM-DD query. Cache-first means
  // each browser downloads a static JSON at most once per service day. ETA APIs
  // are on the live hosts above and never enter this cache.
  if (url.origin === self.location.origin && url.pathname.includes('/data/')) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(response => {
        if (!response || response.status !== 200) return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        return response;
      }))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (!response || response.status !== 200 || response.type === 'opaque') return response;
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
      return response;
    }))
  );
});
