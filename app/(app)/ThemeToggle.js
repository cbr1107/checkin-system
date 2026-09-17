'use client';

import { useEffect, useState } from 'react';

/** 夜間活動時整片白畫面很刺眼，給一個切換。 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState('light');

  useEffect(() => {
    const saved = localStorage.getItem('checkin-theme');
    const initial =
      saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('checkin-theme', next);
    } catch {
      // 無痕模式下寫入會失敗，不影響切換
    }
  }

  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={toggle}
      aria-label={theme === 'dark' ? '切換為淺色' : '切換為深色'}
      title={theme === 'dark' ? '切換為淺色' : '切換為深色'}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
