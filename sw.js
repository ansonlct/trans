const APP_CACHE = 'psk-transport-app-v6.7.8';
const DATA_CACHE = 'psk-transport-data-v6.7.8';

const APP_SHELL = [
  './',
  './index.html',
  './assets/styles.css?v=6.7.8',
  './assets/app.js?v=6.7.8',
  './manifest.webmanifest?v=6.7.8'
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
  event.waitUntil(caches.open(APP_CACHE).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(key => key.startsWith('psk-transport-') && ![APP_CACHE, DATA_CACHE].includes(key))
        .map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

async function networkFirst(request, fallbackRequest = request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.status === 200 && response.type !== 'opaque') {
      const cache = await caches.open(APP_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return (await caches.match(request)) || (await caches.match(fallbackRequest)) || Response.error();
  }
}

async function cacheDailyStatic(request) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (!response || response.status !== 200) return response;

  await cache.put(request, response.clone());

  // Each daily JSON URL contains ?day=YYYY-MM-DD. Keep only the newest entry for
  // the same dataset so months of old service-day files do not accumulate.
  const currentUrl = new URL(request.url);
  const keys = await cache.keys();
  await Promise.all(keys.map(oldRequest => {
    const oldUrl = new URL(oldRequest.url);
    if (oldUrl.pathname === currentUrl.pathname && oldRequest.url !== request.url) {
      return cache.delete(oldRequest);
    }
  }));

  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache live ETA / schedule responses in the Service Worker.
  if (LIVE_API_HOSTS.has(url.hostname)) return;

  if (url.origin === self.location.origin && url.pathname.endsWith('/data/transport-meta.json')) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (url.origin === self.location.origin && url.pathname.includes('/data/')) {
    event.respondWith(cacheDailyStatic(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  }
});
