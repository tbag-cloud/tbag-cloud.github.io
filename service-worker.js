const CACHE_NAME = 'todo-pwa-v17';

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
  const url = new URL(event.request.url);
  const isSupabase = url.hostname.includes('supabase.co') || url.hostname.includes('supabase');
  const isNav = event.request.mode === 'navigate';
  
  // Supabase API - network only, no caching
  if (isSupabase) {
    event.respondWith(fetch(event.request));
    return;
  }
  
  // App shell assets - cache first for speed
  const isAppAsset = url.pathname.endsWith('.js') || 
                     url.pathname.endsWith('.css') || 
                     url.pathname.endsWith('.html') ||
                     url.pathname.endsWith('.webmanifest') ||
                     url.pathname.endsWith('.png');
  
  if (isAppAsset && !isNav) {
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
  
  // Navigation and other requests - network first
  event.respondWith(
    fetch(event.request).catch(() => {
      if (isNav) return caches.match('./index.html');
      return new Response('Offline', { status: 503 });
    })
  );
});
