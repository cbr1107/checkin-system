'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_VERSION } from '@/lib/constants';
import Button from '@/components/ui/Button';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 註冊離線外殼，並在有新版本時提示使用者。
 * 開發模式不註冊，避免快取到熱更新的檔案。
 */
export default function OfflineReady() {
  const [waiting, setWaiting] = useState(null);
  const [updating, setUpdating] = useState(false);
  const reloaded = useRef(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return undefined;
    if (!('serviceWorker' in navigator)) return undefined;

    let registration;
    let timer;

    // 新版本接管後重新載入，只做一次
    const onControllerChange = () => {
      if (reloaded.current) return;
      reloaded.current = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    function watch(reg) {
      registration = reg;

      // 已經有等待中的版本（例如上次沒更新就關掉分頁）
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);

      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // controller 存在代表這不是第一次安裝，而是版本更新
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            setWaiting(installing);
          }
        });
      });

      timer = setInterval(() => reg.update().catch(() => {}), CHECK_INTERVAL_MS);
    }

    // 網址帶版本號：發版後網址改變，瀏覽器才會抓新的 Service Worker
    navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(APP_VERSION)}`)
      .then(watch)
      .catch(() => {
        // 註冊失敗只影響離線重新整理，線上功能不受影響
      });

    const onVisible = () => {
      if (document.visibilityState === 'visible') registration?.update().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      document.removeEventListener('visibilitychange', onVisible);
      if (timer) clearInterval(timer);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    if (!waiting) return;
    setUpdating(true);
    waiting.postMessage({ type: 'SKIP_WAITING' });
  }, [waiting]);

  if (!waiting) return null;

  return (
    <div className="update-banner" role="status">
      <span>有新版本可用</span>
      <Button size="sm" variant="primary" loading={updating} onClick={applyUpdate}>
        立即更新
      </Button>
      <button
        className="toast-close"
        onClick={() => setWaiting(null)}
        aria-label="稍後再說"
      >
        ×
      </button>
    </div>
  );
}
