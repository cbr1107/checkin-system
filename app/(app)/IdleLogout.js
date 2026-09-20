'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { IDLE_TIMEOUT_MS, IDLE_WARNING_MS } from '@/lib/constants';
import Button from '@/components/ui/Button';

const STORAGE_KEY = 'checkin-last-activity';
const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];

const IdleContext = createContext(null);

function format(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 頂部列的閒置倒數 */
export function IdleCountdown() {
  const idle = useContext(IdleContext);
  if (!idle) return null;

  const { remainingMs, paused } = idle;
  const level =
    paused ? 'paused' : remainingMs <= IDLE_WARNING_MS ? 'danger' : remainingMs <= 180000 ? 'warn' : '';

  return (
    <span
      className={`idle-chip ${level}`.trim()}
      title={paused ? '離線中，暫停閒置計時' : '閒置多久後會自動登出'}
    >
      {paused ? '離線' : format(remainingMs)}
    </span>
  );
}

/**
 * 閒置自動登出。
 * 最後一分鐘會先跳提示，讓人來得及按「繼續使用」。
 * 多分頁共用同一個時間戳，任一分頁有動作就一起重新計時。
 */
export default function IdleProvider({ children }) {
  const router = useRouter();
  const lastActivity = useRef(Date.now());
  const loggingOut = useRef(false);
  const [remainingMs, setRemainingMs] = useState(IDLE_TIMEOUT_MS);
  const mountedAt = useRef(Date.now());
  const [paused, setPaused] = useState(false);

  const markActive = useCallback(() => {
    const now = Date.now();
    lastActivity.current = now;
    setRemainingMs(IDLE_TIMEOUT_MS);
    try {
      localStorage.setItem(STORAGE_KEY, String(now));
    } catch {
      // 無痕模式寫入失敗時，退回單一分頁計時
    }
  }, []);

  const logout = useCallback(async () => {
    if (loggingOut.current) return;
    loggingOut.current = true;

    await createClient().auth.signOut();
    router.push('/login?reason=idle');
    router.refresh();
  }, [router]);

  useEffect(() => {
    // 載入頁面本身就是活動。不能沿用 localStorage 裡上一次的時間戳——
    // 那個值可能是幾小時前留下的，會讓剛登入的人立刻被登出。
    markActive();

    for (const name of EVENTS) {
      window.addEventListener(name, markActive, { passive: true });
    }

    function onStorage(event) {
      if (event.key === STORAGE_KEY && event.newValue) {
        lastActivity.current = Number(event.newValue);
        setRemainingMs(IDLE_TIMEOUT_MS);
      }
    }
    window.addEventListener('storage', onStorage);

    const timer = setInterval(() => {
      // 離線時登出只會失敗，而且會讓尚未同步的報到紀錄失去登入狀態
      if (!navigator.onLine) {
        setPaused(true);
        lastActivity.current = Date.now();
        setRemainingMs(IDLE_TIMEOUT_MS);
        return;
      }

      setPaused(false);
      const left = IDLE_TIMEOUT_MS - (Date.now() - lastActivity.current);
      setRemainingMs(left);
      if (left <= 0 && Date.now() - mountedAt.current > 5000) logout();
    }, 1000);

    return () => {
      for (const name of EVENTS) window.removeEventListener(name, markActive);
      window.removeEventListener('storage', onStorage);
      clearInterval(timer);
    };
  }, [markActive, logout]);

  const value = useMemo(
    () => ({ remainingMs, paused, markActive }),
    [remainingMs, paused, markActive]
  );

  const warning = !paused && remainingMs <= IDLE_WARNING_MS && remainingMs > 0;

  return (
    <IdleContext.Provider value={value}>
      {children}

      {warning && (
        <div className="dialog-backdrop">
          <div className="dialog" role="alertdialog" aria-modal="true">
            <h2>即將自動登出</h2>
            <p>已閒置一段時間，{format(remainingMs)} 後會自動登出。</p>
            <div className="dialog-actions">
              <Button variant="primary" onClick={markActive}>
                繼續使用
              </Button>
            </div>
          </div>
        </div>
      )}
    </IdleContext.Provider>
  );
}
