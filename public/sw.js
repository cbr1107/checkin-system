/**
 * 現場報到系統的離線外殼。
 *
 * 版本號由註冊時的 ?v= 帶進來（見 OfflineReady.js）。
 * 每次發版網址就不同，瀏覽器會視為新的 Service Worker 並安裝，
 * 但不會自動接管——等使用者在畫面上按下「立即更新」才切換，
 * 避免報到進行到一半頁面突然重載。
 */
const VERSION = new URL(self.location).searchParams.get('v') || 'dev';
const CACHE = `checkin-${VERSION}`;

self.addEventListener('install', () => {
  // 不呼叫 skipWaiting：新版本先在旁邊等著
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Service Worker 本身與 API 一律走網路
  if (url.pathname === '/sw.js' || url.pathname.startsWith('/api/')) return;

  // 靜態資源：檔名帶雜湊，可以放心用快取
  if (url.pathname.startsWith('/_next/static')) {
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

  // 頁面：先連線，失敗才退回上次看到的版本
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
