/**
 * Service Worker — Kuriér
 *
 * Cache strategy:
 * - /api/* → network-only (NEVER cache authenticated or financial responses)
 * - Static assets → cache-first from explicit allowlist
 * - On activate: purge ALL old caches (versioned by CACHE_NAME)
 *
 * Security rules:
 * - Never cache /api/auth, /api/orders, /api/kitchen, /api/couriers,
 *   /api/courier-earnings, /api/dispatch, /api/courier/*
 * - Never cache responses with Cache-Control: private or no-store
 * - On logout (message event): purge all caches immediately
 */

const CACHE_NAME = 'kurier-v2';
const STATIC_ALLOWLIST = [
  '/kurier',
  '/kurier/',
  '/manifest-kurier.json',
  '/logo.svg',
  '/icon-kurier-192.png',
  '/icon-kurier-512.png',
  '/pizza-hero.png',
  '/pizza-lizard.png',
];

// API paths that must NEVER be cached
const SENSITIVE_API_PATTERNS = [
  '/api/auth',
  '/api/orders',
  '/api/kitchen',
  '/api/couriers',
  '/api/courier-earnings',
  '/api/dispatch',
  '/api/courier',
  '/api/admin',
  '/api/stats',
  '/api/settings',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Use individual fetches so one missing asset doesn't fail the whole install
      Promise.allSettled(STATIC_ALLOWLIST.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => {
            // Purge ALL old caches — no cached personal data survives
            return caches.delete(k);
          })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  // On logout: purge all caches to remove any cached personal data
  if (event.data === 'PURGE_CACHES' || event.data?.type === 'LOGOUT') {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(keys.map((k) => caches.delete(k)))
      ).then(() => {
        if (event.source) {
          event.source.postMessage({ type: 'CACHES_PURGED' });
        }
      })
    );
  }
});

function isSensitiveApi(url) {
  const pathname = new URL(url).pathname;
  return SENSITIVE_API_PATTERNS.some((p) => pathname.startsWith(p));
}

function hasNoStoreHeader(response) {
  const cc = response.headers.get('cache-control') || '';
  return /no-store|private/i.test(cc);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Non-GET: always network-only, never cache
  if (request.method !== 'GET') return;

  const url = request.url;

  // ALL /api/* requests: network-only, never cache
  if (url.includes('/api/')) {
    event.respondWith(
      fetch(request).catch(() => {
        // Offline fallback for API: return a 503 (no stale cache)
        return new Response(
          JSON.stringify({ code: 'OFFLINE', message: 'Ste offline. Skúste to znova.' }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      })
    );
    return;
  }

  // Static assets: cache-first from allowlist only
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Only cache successful responses from the allowlist
        if (
          response.ok &&
          !hasNoStoreHeader(response) &&
          STATIC_ALLOWLIST.some((path) => url.includes(path))
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
