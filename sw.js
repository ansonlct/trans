const CACHE_NAME = 'psk-transport-pages-shell-v6.1.0';

const APP_SHELL = [
  './',
  './index.html',
  './assets/styles.css?v=6.1.0',
  './assets/app.js?v=6.1.0',
  './manifest.webmanifest?v=6.1.0'
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
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

async function networkFirst(request, fallbackRequest = request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.status === 200 && response.type !== 'opaque') {
      const clone = response.clone();
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, clone);
    }
    return response;
  } catch (error) {
    return (await caches.match(request)) ||
           (await caches.match(fallbackRequest)) ||
           Response.error();
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Real-time transport APIs must never be persisted by the Service Worker.
  if (LIVE_API_HOSTS.has(url.hostname)) return;

  // Always retrieve the latest GitHub Action cache-health metadata.
  if (
    url.origin === self.location.origin &&
    url.pathname.endsWith('/data/transport-meta.json')
  ) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  // Daily static mirror JSON: cache each service-day URL after first download.
  if (url.origin === self.location.origin && url.pathname.includes('/data/')) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(async response => {
          if (response && response.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, response.clone());
          }
          return response;
        });
      })
    );
    return;
  }

  // IMPORTANT: navigation must be network-first.
  // This prevents an old Service Worker from keeping an old index.html forever.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }

  // App HTML/CSS/JS/manifest are also network-first, with offline fallback.
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  }
});
