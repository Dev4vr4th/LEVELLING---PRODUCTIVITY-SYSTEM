// Bump this version string every time you push a real update to index.html.
// Changing it forces the browser to install a new service worker, which deletes
// old caches and re-fetches fresh files — without this, users who already
// installed the app would be stuck on the version they first downloaded forever,
// even after you push changes to GitHub Pages.
const CACHE_VERSION = 'v4';
const CACHE_NAME = `the-system-${CACHE_VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Install: pre-cache the core app shell so it's available offline immediately
// after the first visit.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: delete any caches from older versions so storage doesn't grow
// forever and so nothing stale lingers around.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch strategy:
// - For the main HTML page: try the network first (so a logged-in user online
//   always gets the latest version you've deployed), falling back to the cached
//   copy only if the network request fails (i.e. genuinely offline).
// - For everything else (manifest, icons): cache-first, since those rarely change.
self.addEventListener('fetch', (e) => {
  const isHTML = e.request.mode === 'navigate' || e.request.url.endsWith('.html') || e.request.url.endsWith('/');

  if (isHTML) {
    e.respondWith(
      fetch(e.request)
        .then((networkResponse) => {
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, networkResponse.clone()));
          return networkResponse;
        })
        .catch(() => caches.match(e.request).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
