const CACHE_NAME = 'todo-pwa-v9';
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css?v=1.5.0',
  './app-pages.js?v=1.5.0',
  './watchlist.js?v=1.5.0',
  './admin.js?v=1.5.0',
  './todo.js?v=1.5.0',
  './script.js?v=1.5.0',
  './drive.js?v=1.5.0',
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
  
  // Skip Supabase API requests entirely
  if (url.hostname.includes('supabase.co')) {
    return;
  }

  const isSameOrigin = url.origin === self.location.origin;
  const isNavigation = event.request.mode === 'navigate';
  const isAppAsset = isSameOrigin && (
    url.pathname.endsWith('.js')
    || url.pathname.endsWith('.css')
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('.png')
    || url.pathname.endsWith('.webmanifest')
  );

  // For navigation, always try network first
  if (isNavigation) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // For app assets, try cache first
  if (isAppAsset) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Everything else (images etc)
  event.respondWith(
    fetch(event.request).then(response => response).catch(() => caches.match(event.request))
  );
});
