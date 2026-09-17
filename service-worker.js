/* Chrome에 남아 있는 이전 공개형 PWA 캐시를 제거하기 위한 종료용 Service Worker */
const RESET_VERSION = 'staff-portal-reset-20260917-v5';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch (e) {}

    try {
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        try {
          const url = new URL(client.url);
          url.searchParams.set('reset', RESET_VERSION);
          await client.navigate(url.toString());
        } catch (e) {}
      }
    } catch (e) {}

    try { await self.registration.unregister(); } catch (e) {}
  })());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request, { cache: 'no-store' }));
});
