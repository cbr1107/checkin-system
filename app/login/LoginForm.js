'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { accountToEmail } from '@/lib/account';

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

    router.push(
      profile.must_change_password
        ? '/change-password'
        : params.get('next') || '/dashboard'
    );
    router.refresh();
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <h2>登入</h2>
      <p className="lede">請使用管理員發給你的帳號登入。</p>

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

      <button className="btn-primary" style={{ width: '100%' }} disabled={busy}>
        {busy ? '登入中…' : '登入'}
      </button>

      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 20 }}>
        忘記密碼請聯絡系統管理員或註冊長重設。
      </p>
    </form>
  );
}
