// Keeps the app shell available offline, and shows the coach's message notifications.
const CACHE = 'rollcall-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Live data is never cached, and neither is anything from another site.
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(async () => (await caches.match(request)) ?? (await caches.match('/')) ?? Response.error()),
  );
});

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Roll Call', {
      body: data.body ?? '',
      icon: '/brand/icon-192.png',
      badge: '/brand/icon-192.png',
      data: { url: data.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data?.url ?? '/'));
});
