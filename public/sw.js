// Self-clearing and unregistering service worker to force fresh UI updates
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => {
        for (const client of clients) {
          client.navigate(client.url);
        }
      })
  );
});

self.addEventListener('fetch', (event) => {
  // Always fetch directly from network
  return;
});
