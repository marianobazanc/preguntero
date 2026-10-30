/* Preguntero — service worker: guarda la app para que funcione sin internet.
   Al publicar cambios, subí VERSION para que los navegadores bajen la versión nueva. */
const VERSION = 'preguntero-v2';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'db.js',
  'app.js',
  'seed-questions.json',
  'manifest.webmanifest',
  'vendor/howler.min.js',
  'fonts/baloo2-latin.woff2',
  'fonts/nunito-latin.woff2',
  'img/favicon.svg',
  'img/icon-192.png',
  'img/icon-512.png',
  'img/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Primero la copia guardada (anda sin internet); si no está, la red.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
});
