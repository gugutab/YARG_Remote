// Minimal service worker: it only makes the app installable. Nothing is cached (the server revalidates every file), so an update is never stale.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
