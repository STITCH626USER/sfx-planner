// Post-build script: walks dist/ and emits dist/sw.js with a versioned list
// of every static asset to precache. The service worker only caches the app
// shell (HTML, JS, CSS, fonts, images, the pdfjs worker and the lazy pdf
// chunk). It never caches imported PDFs or planning data — those stay
// in-memory in the page, exactly like the online build.
//
// Scope: the SW is registered at the same path it is served from, so on
// GitHub Pages (https://<user>.github.io/sfx-planner/sw.js) its scope is
// `/sfx-planner/` and all precached URLs are relative (`./assets/...`,
// `./index.html`) — matching Vite's `base: './'`.

import { readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

const DIST = new URL('../dist/', import.meta.url).pathname;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (st.isFile()) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(DIST)
  .map((p) => relative(DIST, p).split(sep).join('/'))
  // Don't precache the SW itself or any previous SW build artefacts.
  .filter((p) => p !== 'sw.js')
  .sort();

// Stable cache version derived from the contents of every precached file.
const hash = createHash('sha256');
for (const rel of files) {
  hash.update(rel);
  hash.update('\0');
  hash.update(readFileSync(join(DIST, rel)));
  hash.update('\0');
}
const CACHE_VERSION = hash.digest('hex').slice(0, 12);
const CACHE_NAME = `sfx-planner-${CACHE_VERSION}`;

const precacheList = files.map((f) => `./${f}`);

const sw = `// Service Worker Uninstaller to break cache deadlock loop and force client refresh
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    }).then(() => {
      return self.clients.claim();
    }).then(() => {
      return self.clients.matchAll({ type: 'window' }).then((clients) => {
        for (const client of clients) {
          if (client.navigate) {
            client.navigate(client.url);
          }
        }
      });
    })
  );
});
`;

writeFileSync(join(DIST, 'sw.js'), sw);
console.log(`[generate-sw] wrote dist/sw.js — uninstaller script`);
