// Service worker registration.
//
// Deliberately does NOT prompt to update or call skipWaiting. It doesn't need
// to: the worker serves navigations network-first, and build assets are
// content-hashed, so a page loaded through an older worker still gets fresh
// HTML and fetches the new hashed assets straight from the network. Only the
// precache list lags, and it catches up the next time every tab is closed —
// which is the browser's own default. Forcing a reload would interrupt someone
// mid-edit to fix nothing.
//
// Set VITE_TODOLIST_SW=off at build time to ship without registering (see the
// rollback notes in client/public/sw.js).
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  // Dev runs through Vite's module graph; a caching worker only gets in HMR's way.
  if (!import.meta.env.PROD) return;
  if (import.meta.env.VITE_TODOLIST_SW === 'off') return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/todolist/sw.js', { scope: '/todolist/' }).catch((err: Error) => {
      // Registration failing is survivable — the app works without it, just
      // without an offline shell. Never let it break startup.
      console.warn('[todolist] service worker registration failed:', err.message);
    });
  });
}
