'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ROLE_LABELS } from '@/lib/constants';

export default function UserManager({ me, initialUsers, creatableRoles }) {
  const router = useRouter();
  const [account, setAccount] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState(creatableRoles[0] || 'checkin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const users = initialUsers;

  function reload() {
    router.refresh();
  }

  async function createUser(event) {
    event.preventDefault();
    setError('');
    setOk('');
    setBusy(true);

    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account, display_name: displayName, role }),
    });
    const json = await res.json();
    setBusy(false);

    if (!res.ok) {
      setError(json.error || '建立失敗');
      return;
    }

    setOk(`已建立 ${displayName}，帳號與初始密碼皆為「${json.account}」`);
    setAccount('');
    setDisplayName('');
    reload();
  }

  async function act(user, body, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    setError('');
    setOk('');

    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: body === 'delete' ? 'DELETE' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: body === 'delete' ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(json.error || '操作失敗');
      return;
    }

    if (json.initial_password) {
      setOk(`已將 ${user.display_name} 的密碼重設為「${json.initial_password}」，對方下次登入需重新設定。`);
    } else {
      setOk('已更新。');
    }
    reload();
  }

  const canManage = (user) => {
    if (me.role === 'admin') return user.id !== me.id;
    return user.role === 'checkin' && user.created_by === me.id;
  };

  return (
    <>
      {error && <div className="notice notice-error">{error}</div>}
      {ok && <div className="notice notice-ok">{ok}</div>}

      {creatableRoles.length > 0 && (
        <div className="card">
          <h3>新增帳號</h3>
          <form onSubmit={createUser}>
            <div className="row">
              <label className="field">
                <span>帳號</span>
                <input
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder="例：fx001"
                  autoCapitalize="none"
                  required
                />
              </label>

              <label className="field">
                <span>姓名</span>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                />
              </label>

              <label className="field">
                <span>身分</span>
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  {creatableRoles.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </label>

              <button className="btn-primary" disabled={busy}>
                {busy ? '建立中…' : '建立帳號'}
              </button>
            </div>
          </form>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '12px 0 0' }}>
            帳號限 6–20 字元的英數字與底線，建立後不可更改。
          </p>
        </div>
      )}

      <div className="card">
        <h3>帳號列表（{users.length}）</h3>

        {users.length === 0 ? (
          <div className="empty">目前沒有帳號。用上面的表單建立第一個。</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>帳號</th>
                  <th>姓名</th>
                  <th>身分</th>
                  <th>狀態</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.account}</td>
                    <td>{user.display_name}</td>
                    <td>
                      {me.role === 'admin' && user.id !== me.id ? (
                        <select
                          value={user.role}
                          onChange={(e) =>
                            act(user, { action: 'set_role', role: e.target.value })
                          }
                        >
                          {Object.entries(ROLE_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        ROLE_LABELS[user.role]
                      )}
                    </td>
                    <td>
                      {!user.is_active
                        ? '已停用'
                        : user.must_change_password
                          ? '待首次登入'
                          : '使用中'}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {canManage(user) && (
                        <>
                          <button
                            className="btn-quiet btn-sm"
                            onClick={() =>
                              act(
                                user,
                                { action: 'reset_password' },
                                `將 ${user.display_name} 的密碼重設為帳號「${user.account}」？`
                              )
                            }
                          >
                            重設密碼
                          </button>{' '}
                          <button
                            className="btn-quiet btn-sm"
                            onClick={() =>
                              act(user, {
                                action: 'set_active',
                                is_active: !user.is_active,
                              })
                            }
                          >
                            {user.is_active ? '停用' : '啟用'}
                          </button>{' '}
                          <button
                            className="btn-danger btn-sm"
                            onClick={() =>
                              act(
                                user,
                                'delete',
                                `刪除 ${user.display_name}（${user.account}）？此操作無法復原。`
                              )
                            }
                          >
                            刪除
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
