'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { accountToEmail } from '@/lib/account';

const MIN_LENGTH = 8;

export default function ChangePasswordForm({ account, displayName, forced }) {
  const router = useRouter();
  const [oldPassword, setOldPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (password.length < MIN_LENGTH) {
      setError(`新密碼至少 ${MIN_LENGTH} 個字元`);
      return;
    }
    if (password !== confirm) {
      setError('兩次輸入的新密碼不一致');
      return;
    }
    if (password.toLowerCase() === account.toLowerCase()) {
      setError('新密碼不能與帳號相同');
      return;
    }

    setBusy(true);
    const supabase = createClient();

    // 非強制變更時，先用舊密碼重新驗證
    if (!forced) {
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: accountToEmail(account),
        password: oldPassword,
      });
      if (reauthError) {
        setError('目前密碼不正確');
        setBusy(false);
        return;
      }
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message || '密碼更新失敗，請再試一次');
      setBusy(false);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    await supabase
      .from('app_users')
      .update({ must_change_password: false })
      .eq('id', user.id);

    router.push('/dashboard');
    router.refresh();
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <h2>{forced ? '設定新密碼' : '變更密碼'}</h2>
      <p className="lede">
        {displayName}（{account}）
      </p>

      {error && <div className="notice notice-error">{error}</div>}

      {!forced && (
        <label className="field">
          <span>目前密碼</span>
          <input
            type="password"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
      )}

      <label className="field">
        <span>新密碼（至少 {MIN_LENGTH} 字元）</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
          autoFocus={forced}
        />
      </label>

      <label className="field">
        <span>再輸入一次新密碼</span>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
      </label>

      <button className="btn-primary" style={{ width: '100%' }} disabled={busy}>
        {busy ? '儲存中…' : '儲存新密碼'}
      </button>
    </form>
  );
}
