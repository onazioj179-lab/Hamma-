const CACHE_NAME = 'spk-maintenance-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/manifest.json',
    '/assets/zip.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache)).then(() => self.skipWaiting())
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin ||
        new URL(event.request.url).pathname === '/config.js') return;
    event.respondWith(
        fetch(event.request).then(response => {
            if (response.ok) {
                const copy = response.clone();
                event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)));
            }
            return response;
        }).catch(() => caches.match(event.request))
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(names => Promise.all(names
        .filter(name => name.startsWith('spk-') && name !== CACHE_NAME)
        .map(name => caches.delete(name)))).then(() => self.clients.claim()));
});
