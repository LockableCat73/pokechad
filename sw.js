/**
 * Service worker: makes PokéChad installable and usable offline.
 *
 * Two caches, two strategies:
 *   shell   pages, scripts, styles and the Pokédex data. Network first, so a
 *           new deploy shows up on the next load; the cache is the fallback
 *           when offline.
 *   art     sprites, icons and fonts. Cache first: these files never change
 *           under the same name, so each one is downloaded once.
 *
 * Shortly after the page loads it sends a "precache-art" message listing every
 * sprite. They are fetched quietly in the background (about 3 MB in total),
 * so that any Pokémon can be revealed while offline.
 *
 * Bump VERSION to throw away both caches after a breaking change.
 */

const VERSION = 'v1';
const SHELL = `pokechad-shell-${VERSION}`;
const ART = `pokechad-art-${VERSION}`;

const SHELL_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'data/pokedex.json',
  'js/app.js',
  'js/dom.js',
  'js/pixelart.js',
  'js/rewards.js',
  'js/scoring.js',
  'js/sfx.js',
  'js/state.js',
  'js/stopwatch.js',
  'js/views/dashboard.js',
  'js/views/history.js',
  'js/views/pokedex.js',
  'js/views/rate.js',
  'js/views/reveal.js',
  'js/views/settings.js',
  'js/views/starter.js',
  'js/views/stats.js',
];

const ART_FILES = [
  'assets/fonts/PressStart2P-Regular.ttf',
  'assets/icons/snorlax.png',
  'assets/icons/zacian-crowned.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL).then((cache) => cache.addAll(SHELL_FILES)),
      caches.open(ART).then((cache) => cache.addAll(ART_FILES)),
    ]).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== SHELL && n !== ART).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/assets/')) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data && data.type === 'precache-art' && Array.isArray(data.urls)) {
    event.waitUntil(precacheArt(data.urls));
  }
});

/** Download every listed file that is not cached yet, a few at a time. */
async function precacheArt(urls) {
  const cache = await caches.open(ART);
  const queue = urls.slice();
  const worker = async () => {
    while (queue.length > 0) {
      const url = queue.shift();
      try {
        if (await cache.match(url)) continue;
        const response = await fetch(url);
        if (response.ok) await cache.put(url, response);
      } catch {
        return; // offline or interrupted; the next page load carries on
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}

async function cacheFirst(request) {
  const cache = await caches.open(ART);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = (await cache.match(request, { ignoreSearch: true })) || (request.mode === 'navigate' ? await cache.match('index.html') : null);
    if (hit) return hit;
    throw error;
  }
}
