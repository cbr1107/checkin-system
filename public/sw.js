/**
 * 現場報到系統的離線外殼。
 * 只做兩件事：快取靜態資源，以及把造訪過的頁面存起來，
 * 讓現場斷線後重新整理仍打得開報到畫面。
 * 報到資料本身存在 IndexedDB，不經過這裡。
 */
const CACHE = 'checkin-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 靜態資源：先用快取
  if (url.pathname.startsWith('/_next/static') || url.pathname === '/sw.js') {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
            return res;
          })
      )
    );
    return;
  }

  // 頁面：先連線，失敗時退回上次看到的版本
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() =>
          caches
            .match(request)
            .then((hit) => hit || caches.match('/checkin'))
            .then(
              (hit) =>
                hit ||
                new Response('離線中，且這個頁面還沒有快取。', {
                  status: 503,
                  headers: { 'Content-Type': 'text/plain; charset=utf-8' },
                })
            )
        )
    );
  }
});
