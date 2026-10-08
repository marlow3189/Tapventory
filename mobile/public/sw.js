/* Tapventory — service worker (PWA).
 *
 * Cel: aplikacja otwiera się natychmiast i NIE wywala się, gdy telefon złapie zasięg „na jedną kreskę".
 * To NIE jest pełny tryb offline (zapisy offline to osobny etap w kolejce budowy) — dane zawsze
 * pobieramy z serwera; ten plik przechowuje tylko „szkielet" aplikacji.
 *
 * Strategie:
 *   • nawigacja (HTML)                       → najpierw sieć, a gdy jej brak — zapisany szkielet "/"
 *   • /_expo/static/*, /assets/*, ikony, wasm → najpierw pamięć podręczna (nazwy z hashem się nie zmieniają)
 *   • wszystko inne, w tym API Supabase      → NIE dotykamy (idzie prosto do sieci)
 *
 * Nowa wersja aplikacji: zmień CACHE_VERSION — stare pamięci podręczne zostaną usunięte.
 */
const CACHE_VERSION = 'tv-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/favicon-32.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isStatic = (url) =>
  url.pathname.startsWith('/_expo/static/') ||
  url.pathname.startsWith('/assets/') ||
  /\.(png|svg|ico|woff2?|ttf|wasm)$/.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Supabase, CDN itd. — bez pośrednictwa

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || Response.error()))
    );
    return;
  }

  if (isStatic(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
  }
});
