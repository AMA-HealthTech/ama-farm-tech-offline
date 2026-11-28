/*!
 * AMA FarmTech Offline - service-worker.js
 * Ama Farms Ltd
 *
 * Keeps the app shell (HTML, CSS, JavaScript, manifest, icons) in a cache so the
 * app opens with no internet. Strategy: cache-first for the app shell.
 *
 * IMPORTANT - when you change ANY app file, change VERSION below (and APP_VERSION in db.js).
 * A new VERSION makes phones download the new files into a new cache and show
 * "A new version is ready". The old cache is only deleted after the new one is active.
 *
 * Farm records are NOT handled here. They live in IndexedDB and never pass through this file.
 * Every path is relative to this file, so the app works from any folder,
 * for example https://username.github.io/ama-farmtech-offline/
 */
'use strict';

const VERSION = '1.1.0';
const CACHE_PREFIX = 'ama-farmtech-shell-';
const CACHE_NAME = CACHE_PREFIX + VERSION;

// Relative to the service worker file (its folder is the app's folder).
const APP_SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'db.js',
  'crops.js',
  'crops-ui.js',
  'backup.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

const toUrl = (path) => new URL(path, self.location.href).href;
const INDEX_URL = toUrl('index.html');

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        // cache: 'reload' skips the browser's HTTP cache so a fresh copy is stored.
        // addAll is all-or-nothing: if one file fails, this version is not installed.
        await cache.addAll(APP_SHELL.map((p) => new Request(toUrl(p), { cache: 'reload' })));
      } catch (err) {
        // A half-uploaded release must leave no trace: remove the empty cache, keep the old version running.
        await caches.delete(CACHE_NAME);
        throw err;
      }
      // No skipWaiting here on purpose. The app asks the person first (see SKIP_WAITING below),
      // so the files never change underneath someone who is in the middle of entering data.
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch other sites

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      if (req.mode === 'navigate') {
        // Any page request in this app opens the cached app page (the app uses #/ routes).
        const page = (await cache.match(req, { ignoreSearch: true })) || (await cache.match(INDEX_URL));
        if (page) return page;
        try {
          return await fetch(req);
        } catch (e) {
          return new Response('AMA FarmTech Offline has not been saved on this phone yet. Open it once while online.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
      }

      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      // Not part of the app shell: try the network, do not store it.
      try {
        return await fetch(req);
      } catch (e) {
        return new Response('', { status: 504, statusText: 'Offline and not cached' });
      }
    })()
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data.type === 'GET_STATUS' && event.ports && event.ports[0]) {
    const port = event.ports[0];
    event.waitUntil(
      (async () => {
        let cached = 0;
        try {
          const cache = await caches.open(CACHE_NAME);
          const hits = await Promise.all(APP_SHELL.map((p) => cache.match(toUrl(p))));
          cached = hits.filter(Boolean).length;
        } catch (e) {
          cached = 0;
        }
        port.postMessage({ version: VERSION, cache: CACHE_NAME, cached, expected: APP_SHELL.length });
      })()
    );
  }
});
