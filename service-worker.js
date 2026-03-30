const CACHE_NAME = 'todo-pwa-v4';
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css?v=1.2.0',
  './app-pages.js?v=1.2.0',
  './script.js?v=1.2.0',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isNavigation = event.request.mode === 'navigate';
  const isAppShellAsset = isSameOrigin && (
    url.pathname.endsWith('/index.html')
    || url.pathname === '/'
    || url.pathname.endsWith('/style.css')
    || url.pathname.endsWith('/script.js')
    || url.pathname.endsWith('/manifest.webmanifest')
  );

  event.respondWith(
    (isNavigation || isAppShellAsset)
      ? fetch(event.request)
          .then(response => {
            if (response && response.status === 200) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
            }
            return response;
          })
          .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
      : caches.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            if (!response || response.status !== 200 || response.type !== 'basic') return response;
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
            return response;
          });
        })
  );
});
