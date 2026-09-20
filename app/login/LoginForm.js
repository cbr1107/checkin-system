'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { accountToEmail } from '@/lib/account';
import Button from '@/components/ui/Button';

export default function LoginForm({ initialError }) {
  const router = useRouter();
  const params = useSearchParams();

  const [mode, setMode] = useState('password');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError || '');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(null);

  const [cameraOn, setCameraOn] = useState(false);
  const scannerRef = useRef(null);
  const keyInputRef = useRef(null);

  /** 帳號密碼登入的收尾：狀態與 IP 檢查都在同一支 API */
  const finishPassword = useCallback(
    async (supabase) => {
      setStage('checking');

      const ipCheck = await fetch('/api/auth/login-check', { method: 'POST' })
        .then((r) => r.json())
        .catch(() => ({ allowed: true }));

      if (!ipCheck.allowed) {
        await supabase.auth.signOut();
        setError(
          ipCheck.reason === 'ip_limit'
            ? `這個帳號最多只能從 ${ipCheck.limit} 個網路位置登入，目前的位置（${ipCheck.ip}）不在其中。請聯絡管理員。`
            : ipCheck.reason === 'inactive'
              ? '此帳號已停用，請聯絡系統管理員'
              : '登入驗證失敗，請重新登入'
        );
        setBusy(false);
        setStage(null);
        return;
      }

      setStage('entering');
      router.push(
        ipCheck.must_change_password ? '/change-password' : params.get('next') || '/dashboard'
      );
    },
    [router, params]
  );

  async function handlePassword(event) {
    event.preventDefault();
    setError('');
    setBusy(true);

    setStage('verifying');
    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: accountToEmail(account),
      password,
    });

    if (signInError) {
      setError('帳號或密碼不正確');
      setBusy(false);
      setStage(null);
      return;
    }

    await finishPassword(supabase);
  }

  const submitKey = useCallback(
    async (rawKey) => {
      const key = String(rawKey || '').trim();
      if (!key || busy) return;

      setError('');
      setBusy(true);
      setStage('verifying');

      const res = await fetch('/api/auth/qr-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      }).catch(() => null);

      const json = res ? await res.json().catch(() => ({})) : {};

      if (!res || !res.ok) {
        setError(json.error || '這組識別碼無法登入');
        setBusy(false);
        setStage(null);
        return;
      }

      setStage('signing');
      const supabase = createClient();
      const { data, error: otpError } = await supabase.auth.verifyOtp({
        type: 'email',
        token_hash: json.token_hash,
      });

      if (otpError || !data?.user) {
        setError('登入失敗，請再試一次');
        setBusy(false);
        setStage(null);
        return;
      }

      // 帳號狀態與 IP 檢查已在上一步完成，直接進系統
      setStage('entering');
      router.push(
        json.must_change_password ? '/change-password' : params.get('next') || '/dashboard'
      );
    },
    [busy, router, params]
  );

  /* ---------------- 相機 ---------------- */
  const stopCamera = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (scanner) {
      try {
        await scanner.stop();
        await scanner.clear();
      } catch {
        // 已經停掉了
      }
    }
  }, []);

  useEffect(() => () => { stopCamera(); }, [stopCamera]);

  useEffect(() => {
    if (mode === 'qr') keyInputRef.current?.focus();
    else stopCamera().then(() => setCameraOn(false));
  }, [mode, stopCamera]);

  async function toggleCamera() {
    if (cameraOn) {
      await stopCamera();
      setCameraOn(false);
      return;
    }

    setError('');
    setCameraOn(true);
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );

    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const scanner = new Html5Qrcode('login-qr-reader', { verbose: false });
      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: (w, h) => {
            const edge = Math.floor(Math.min(w, h) * 0.75);
            return { width: edge, height: edge };
          },
        },
        async (text) => {
          setStage('verifying');
          setBusy(true);
          await stopCamera();
          setCameraOn(false);
          submitKey(text);
        },
        () => {}
      );
      scannerRef.current = scanner;
    } catch (err) {
      setCameraOn(false);
      setError(`無法啟動相機：${err?.message || '未知錯誤'}`);
    }
  }

  const STAGES = {
    verifying: '驗證識別碼',
    checking: '確認帳號狀態',
    signing: '建立登入狀態',
    entering: '進入系統',
  };
  const STAGE_ORDER = ['verifying', 'checking', 'signing', 'entering'];

  return (
    <div className="auth-form">
      {stage && (
        <div className="login-progress" role="status" aria-live="polite">
          <div className="login-progress-box">
            <span className="pulse-ring" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <strong>{STAGES[stage]}…</strong>
            <span className="login-steps" aria-hidden="true">
              {STAGE_ORDER.filter((k) => k !== 'checking' || mode === 'password').map((k) => (
                <span
                  key={k}
                  className={
                    STAGE_ORDER.indexOf(k) < STAGE_ORDER.indexOf(stage)
                      ? 'done'
                      : k === stage
                        ? 'active'
                        : ''
                  }
                />
              ))}
            </span>
          </div>
        </div>
      )}

      <h2>登入</h2>

      <div className="login-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={mode === 'password'}
          className={mode === 'password' ? 'active' : ''}
          onClick={() => setMode('password')}
        >
          帳號密碼
        </button>
        <button
          role="tab"
          aria-selected={mode === 'qr'}
          className={mode === 'qr' ? 'active' : ''}
          onClick={() => setMode('qr')}
        >
          掃碼登入
        </button>
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      {mode === 'password' ? (
        <form onSubmit={handlePassword}>
          <label className="field">
            <span>帳號</span>
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              required
            />
          </label>

          <label className="field">
            <span>密碼</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            登入
          </Button>
        </form>
      ) : (
        <>
          <div className="camera-box login-camera">
            <div id="login-qr-reader" className={cameraOn ? '' : 'hidden'} />
            {!cameraOn && <div className="camera-placeholder">尚未開啟相機</div>}
          </div>

          <Button block loading={busy && cameraOn} onClick={toggleCamera}>
            {cameraOn ? '關閉相機' : '開啟相機掃碼'}
          </Button>

          <label className="field" style={{ marginTop: 18 }}>
            <span>或以條碼槍掃描 / 手動輸入識別碼</span>
            <input
              ref={keyInputRef}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const value = e.currentTarget.value;
                  e.currentTarget.value = '';
                  submitKey(value);
                }
              }}
            />
          </label>
        </>
      )}
    </div>
  );
}
