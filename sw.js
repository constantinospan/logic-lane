// Service worker: makes Logic Lane work offline and installable (D9, D16).
// VERSION is "dev" in the repo. The deploy job replaces it with a hash of the shipped files. Never edit it by
// hand. Every shipped file must be listed in PRECACHE (a test checks this).

const VERSION = 'dev';
const PREFIX = 'logic-lane:';
const CACHE = `${PREFIX}${VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './js/app.js',
  './js/core/games.js',
  './js/core/ladder.js',
  './js/core/rng.js',
  './js/core/speech.js',
  './js/core/storage.js',
  './js/pwa/update.js',
  './js/ui/celebrate.js',
  './js/ui/dom.js',
  './js/ui/home.js',
  './js/ui/picker.js',
  './js/ui/play.js',
  './js/ui/reset.js',
  './js/ui/topbar.js',
  './games/demo/game.js',
];

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

sw.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name); // never touch other sites
      }
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') sw.skipWaiting();
});

sw.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  if (!url.pathname.startsWith(new URL('./', location.href).pathname)) return; // outside our folder

  if (VERSION === 'dev') {
    event.respondWith(networkFirst(request)); // local and review runs always see the latest files
  } else {
    event.respondWith(cacheFirst(request));
  }
});

/** @param {Request} request */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  if (request.mode === 'navigate') {
    const page = await cache.match('./index.html');
    if (page) return page;
  }
  return fetch(request);
}

/** @param {Request} request */
async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE);
    return (
      (await cache.match(request, { ignoreSearch: true })) ??
      (request.mode === 'navigate' ? await cache.match('./index.html') : undefined) ??
      Response.error()
    );
  }
}
