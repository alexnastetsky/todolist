// Service worker for the Todos PWA (scope: /todolist/).
//
// Deliberately hand-written. The build uses rolldown-vite, so a Workbox plugin
// is a compatibility bet we don't need to take — and a worker we wrote is one
// we can switch off on demand, which the rollback plan depends on.
//
// ROLLBACK: set KILL to true and deploy. That build unregisters itself, drops
// every cache it owns, and reloads open tabs — removing the worker from
// browsers that already have it. Reverting the commit does NOT do this: an
// installed worker survives a revert and would keep serving a cached shell.
// Ship the kill build first, let it propagate, then revert the code.
const KILL = false;

/* __SW_BUILD__ — the lines below are rewritten by scripts/generate-sw-precache.mjs */
const VERSION = 'dev';
const PRECACHE = ['/todolist/'];
/* __SW_BUILD_END__ */

const CACHE = `todolist-${VERSION}`;
const SHELL = '/todolist/';
const API_PREFIX = '/todolist/api';

// The shell must be the real app, not the Databricks login page. If the OAuth
// session happens to be expired while the worker installs, the fetch for '/'
// returns login HTML — caching that would strand the app behind a dead page
// offline. Cheap structural check: the SPA always ships this mount point.
const SHELL_MARKER = 'id="root"';

async function dropOwnCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith('todolist-')).map((k) => caches.delete(k)));
}

if (KILL) {
  // Tombstone build: take over immediately, clean up, and get out of the way.
  self.addEventListener('install', (e) => e.waitUntil(self.skipWaiting()));
  self.addEventListener('activate', (e) =>
    e.waitUntil(
      (async () => {
        await dropOwnCaches();
        await self.registration.unregister();
        const clients = await self.clients.matchAll({ type: 'window' });
        for (const c of clients) c.navigate(c.url);
      })()
    )
  );
} else {
  self.addEventListener('install', (e) =>
    e.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE);
        // Assets are content-hashed, so they can be fetched and trusted as-is.
        const assets = PRECACHE.filter((u) => u !== SHELL);
        await cache.addAll(assets);

        const res = await fetch(SHELL, { credentials: 'same-origin' });
        const body = await res.clone().text();
        if (res.ok && body.includes(SHELL_MARKER)) {
          await cache.put(SHELL, res);
        }
        // If it didn't look like the app, we simply have no offline fallback
        // until the next install. Failing open beats caching a login page.
      })()
    )
  );

  self.addEventListener('activate', (e) =>
    e.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((k) => k.startsWith('todolist-') && k !== CACHE).map((k) => caches.delete(k))
        );
        await self.clients.claim();
      })()
    )
  );

  // The page asks for the swap once the user accepts it, so an update never
  // reloads the app out from under someone mid-edit.
  self.addEventListener('message', (e) => {
    if (e.data === 'SKIP_WAITING') void self.skipWaiting();
  });

  self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // Per-user data, served no-store. Never cached, never served from cache,
    // never given an offline fallback — a stale task list is worse than an
    // error, and a cached one could outlive a sign-out.
    if (url.pathname.startsWith(API_PREFIX)) return;

    // Navigations: network-first, so an online browser behaves exactly as it
    // does today — including following the OAuth redirect when the session has
    // expired. The cache is consulted only when the network genuinely fails.
    // Responses are never written back here: a login page must not become the
    // shell.
    if (request.mode === 'navigate') {
      event.respondWith(
        (async () => {
          try {
            return await fetch(request);
          } catch {
            const cached = await caches.match(SHELL);
            return cached ?? Response.error();
          }
        })()
      );
      return;
    }

    // Content-hashed build output and icons: cache-first is safe because the
    // filename changes whenever the bytes do.
    if (url.pathname.startsWith('/todolist/assets/') || url.pathname.startsWith('/todolist/icons/')) {
      event.respondWith(
        (async () => {
          const hit = await caches.match(request);
          if (hit) return hit;
          const res = await fetch(request);
          if (res.ok) {
            const cache = await caches.open(CACHE);
            void cache.put(request, res.clone());
          }
          return res;
        })()
      );
    }
  });

  // Everything needed to render the notification travels in the payload. The
  // worker can wake with no valid OAuth session, so fetching details here
  // would land on the Databricks login page instead of data.
  self.addEventListener('push', (event) => {
    if (!event.data) return;
    let payload;
    try {
      payload = event.data.json();
    } catch {
      return;
    }
    if (!payload || !payload.title) return;

    event.waitUntil(
      self.registration.showNotification(payload.title, {
        icon: '/todolist/icons/icon-192.png',
        // Same tag as the server-side dedupe key, so repeat notifications
        // about one task replace each other instead of stacking.
        tag: payload.tag,
        data: { url: payload.url || SHELL },
      })
    );
  });

  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = (event.notification.data && event.notification.data.url) || SHELL;

    event.waitUntil(
      (async () => {
        // Reuse an already-open window rather than spawning a second copy of
        // an installed app.
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windows) {
          if (!client.url.includes('/todolist/')) continue;
          await client.focus();
          if ('navigate' in client) await client.navigate(target);
          return;
        }
        await self.clients.openWindow(target);
      })()
    );
  });
}
