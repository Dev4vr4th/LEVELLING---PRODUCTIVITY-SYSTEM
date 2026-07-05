const CACHE_VERSION = 'v7';
const CACHE_NAME = `the-system-${CACHE_VERSION}`;
const FONT_CACHE = `the-system-fonts-${CACHE_VERSION}`;

// Core app shell — cached at install time so the app loads instantly offline
// after the very first visit (before any user interaction).
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== FONT_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = e.request.url;

  // Google Fonts: cache-first with a long-lived separate cache so fonts
  // survive app shell cache bumps and are always available offline after
  // the first successful load.
  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.open(FONT_CACHE).then((cache) =>
        cache.match(e.request).then((cached) => {
          if (cached) return cached;
          return fetch(e.request).then((response) => {
            cache.put(e.request, response.clone());
            return response;
          }).catch(() => cached);
        })
      )
    );
    return;
  }

  // Main HTML: network-first so updates reach users when online,
  // falling back to cached copy when offline.
  const isHTML = e.request.mode === 'navigate' ||
                 url.endsWith('.html') ||
                 url.endsWith('/');

  if (isHTML) {
    e.respondWith(
      fetch(e.request)
        .then((networkResponse) => {
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, networkResponse.clone()));
          return networkResponse;
        })
        .catch(() =>
          caches.match(e.request).then((cached) => cached || caches.match('./index.html'))
        )
    );
    return;
  }

  // Everything else (manifest, icons): cache-first.
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
