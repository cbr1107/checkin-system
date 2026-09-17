'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { accountToEmail } from '@/lib/account';
import Button from '@/components/ui/Button';

export default function LoginForm({ initialError }) {
  const router = useRouter();
  const params = useSearchParams();
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError || '');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);

    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: accountToEmail(account),
      password,
    });

    if (signInError) {
      setError('帳號或密碼不正確');
      setBusy(false);
      return;
    }

    const { data: profile } = await supabase
      .from('app_users')
      .select('is_active, must_change_password')
      .eq('id', data.user.id)
      .single();

    if (!profile) {
      await supabase.auth.signOut();
      setError('這組帳號尚未完成設定，請聯絡系統管理員');
      setBusy(false);
      return;
    }

    if (!profile.is_active) {
      await supabase.auth.signOut();
      setError('此帳號已停用，請聯絡系統管理員');
      setBusy(false);
      return;
    }

    const ipCheck = await fetch('/api/auth/login-check', { method: 'POST' })
      .then((r) => r.json())
      .catch(() => ({ allowed: true }));

    if (!ipCheck.allowed) {
      await supabase.auth.signOut();
      setError(
        ipCheck.reason === 'ip_limit'
          ? `這個帳號最多只能從 ${ipCheck.limit} 個網路位置登入，目前的位置（${ipCheck.ip}）不在其中。請聯絡管理員。`
          : '登入驗證失敗，請重新登入'
      );
      setBusy(false);
      return;
    }

    // 保持 busy：導頁需要時間，這段不能讓按鈕看起來可以再按
    router.push(
      profile.must_change_password ? '/change-password' : params.get('next') || '/dashboard'
    );
    router.refresh();
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <h2>登入</h2>

      {error && <div className="notice notice-error">{error}</div>}

      <label className="field">
        <span>帳號</span>
        <input
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          required
          autoFocus
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
  );
}
