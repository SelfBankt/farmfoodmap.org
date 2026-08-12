// Bump this on any caching-strategy change so activate() clears out the old cache
// instead of serving a mix of old and new entries.
const CACHE_NAME = 'FarmFoodMapOrg_v0.0.3';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// App shell (the hashed JS/CSS bundle, static icons) rarely changes per-request and
// isn't worth re-fetching every load — serve from cache, and populate the cache the
// first time a given URL is actually requested.
const cacheFirst = async (request) => {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
};

// The page itself: prefer the network so visitors get the latest deploy, but fall
// back to whatever shell we last cached when there's no connection. Matched
// ignoring the query string, since navigations carry `?lat=&lng=&z=` that changes
// on every pan/zoom but doesn't change which HTML document to serve.
const networkFirst = async (request) => {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (e) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw e;
  }
};

// Map tiles and Overpass query results: instant paint from whatever's cached (if
// anything), refreshed in the background when online. Good fit for data that's
// slow-changing and where a previously-seen area should still work with no signal.
const staleWhileRevalidate = async (request) => {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (request.destination === 'script' || request.destination === 'style') {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.destination === 'image') {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Overpass API responses (the live farm-listing queries as the user pans/zooms) —
  // same origin-agnostic treatment as tiles, so previously-viewed areas keep working
  // offline even though this is a plain `fetch()` rather than an <img>.
  if (request.url.includes('/osm/tools/overpass/api/interpreter')) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
