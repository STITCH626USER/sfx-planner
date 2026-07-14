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

const sw = `const CACHE_NAME = '${CACHE_NAME}';
const PRECACHE = ${JSON.stringify(precacheList)};

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      
      if (event.request.mode === 'navigate') {
        return caches.match('./index.html');
      }
      
      return fetch(event.request);
    })
  );
});
`;

writeFileSync(join(DIST, 'sw.js'), sw);
console.log(`[generate-sw] wrote dist/sw.js — offline service worker (${CACHE_NAME} with ${precacheList.length} files)`);
