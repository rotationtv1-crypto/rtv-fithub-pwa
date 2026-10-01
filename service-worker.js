const CACHE_NAME = 'rtv-fithub-shell-v2';
const APP_SHELL = [
  './', './index.html', './app.js', './config.js', './workouts.json',
  './manifest.json', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin ||
      new URL(event.request.url).pathname.includes('/api/')) return;
  event.respondWith(caches.match(event.request).then(cached => cached ||
    fetch(event.request).then(response => {
      if (response.ok && new URL(event.request.url).pathname.startsWith(self.registration.scope.replace(self.location.origin, ''))) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())
  ));
});
