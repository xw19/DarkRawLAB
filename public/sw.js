const CACHE_NAME = "darkraw-lab-v1";

// Immediately precache the shell resources
const PRECACHE_ASSETS = [
  "./",
  "./index.html"
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  // Only cache GET requests
  if (e.request.method !== "GET") return;

  const url = new URL(e.request.url);

  // Skip tracking non-http resources (e.g. chrome extensions)
  if (!url.protocol.startsWith("http")) return;

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      // Fetch from network to update the cache asynchronously
      const fetchPromise = fetch(e.request).then((networkResponse) => {
        if (networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Fallback silently if offline and resource not cached
      });

      // Return cache immediately if available, otherwise fallback to network fetch
      return cachedResponse || fetchPromise;
    })
  );
});
