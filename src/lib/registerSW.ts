// Register the offline service worker.
//
// The SW only precaches the static files produced by `vite build` (HTML, JS,
// CSS, fonts/images, the lazy `pdf-*.js` chunk and `pdf.worker.min-*.js`).
// It does NOT cache or transmit any PDF the user imports, nor any planning
// data — PDFs are parsed entirely in the page and never leave the device.
// Purpose: avoid the "Failed to fetch dynamically imported module" error
// when the user is offline (airplane mode, no signal) after a first online
// visit.

export function registerOfflineSW(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  // Unregister all active service workers to prevent cache locking and ensure the latest dashboard redesign is visible instantly
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister().then((success) => {
        if (success) {
          // eslint-disable-next-line no-console
          console.info('[sfx-planner] successfully unregistered service worker to bypass cache');
        }
      });
    }
  });

  // Clear all PWA caches
  if (typeof caches !== 'undefined') {
    caches.keys().then((keys) => {
      keys.forEach((key) => caches.delete(key));
    });
  }
}

