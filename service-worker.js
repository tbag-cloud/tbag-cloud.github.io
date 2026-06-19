const CACHE_NAME = 'todo-pwa-v34';

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(CORE_ASSETS.map(url =>
        cache.add(url).catch(() => {})
      ))
    ).then(() => self.skipWaiting())
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
  
  // Navigation - network first, fall back to cached index.html
  if (isNav) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('./index.html'))
    );
    return;
  }
  
  // Static assets (.js, .css, .html, .webmanifest, .png) - cache first
  const isAppAsset = url.pathname.endsWith('.js') || 
                     url.pathname.endsWith('.css') || 
                     url.pathname.endsWith('.html') ||
                     url.pathname.endsWith('.webmanifest') ||
                     url.pathname.endsWith('.png');
  
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
  
  // Everything else - network only
  event.respondWith(fetch(event.request));
});
