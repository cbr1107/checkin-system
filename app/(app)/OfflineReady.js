'use client';

import { useEffect } from 'react';

/** 註冊離線外殼。開發模式不註冊，避免快取到熱更新的檔案。 */
export default function OfflineReady() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // 註冊失敗只影響離線重新整理，線上功能不受影響
    });
  }, []);

  return null;
}
