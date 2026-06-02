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
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  // Service workers require a secure context. localhost is treated as secure.
  if (!window.isSecureContext) return;

  // The HTML <base> resolves to the directory the app was served from
  // (`/sfx-planner/` on GitHub Pages, `/` in local preview). Pointing the
  // SW URL at that base keeps the scope correct without hardcoding.
  const swUrl = new URL('sw.js', document.baseURI).toString();
  const scope = new URL('./', document.baseURI).toString();

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(swUrl, { scope })
      .then((reg) => {
        // Surface readiness in the console only — no UI noise.
        // eslint-disable-next-line no-console
        console.info('[sfx-planner] offline cache ready (scope:', reg.scope, ')');

        // Check for updates
        reg.addEventListener('updatefound', () => {
          const installingWorker = reg.installing;
          if (installingWorker) {
            installingWorker.addEventListener('statechange', () => {
              if (installingWorker.state === 'installed') {
                if (navigator.serviceWorker.controller) {
                  // New update is ready (skipWaiting in sw.js will activate it immediately,
                  // triggering controllerchange below).
                  // eslint-disable-next-line no-console
                  console.info('[sfx-planner] New update found and installing...');
                }
              }
            });
          }
        });
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[sfx-planner] SW registration failed:', err);
      });
  });

  // Reload the page when the controlling service worker changes
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}

