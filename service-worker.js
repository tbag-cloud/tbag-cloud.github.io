const CACHE_NAME = 'todo-pwa-v15';

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
  
  // Skip Supabase - let browser handle it
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(event.request));
    return;
  }
  
  // App assets - cache first
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.html')) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
    return;
  }
  
  // Everything else - network first
  event.respondWith(fetch(event.request));
});
