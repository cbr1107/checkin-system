'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ROLE_LABELS } from '@/lib/constants';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import { useToast, useConfirm } from '@/components/ui/UiProvider';

export default function UserManager({ me, initialUsers, creatableRoles }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const [account, setAccount] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState(creatableRoles[0] || 'checkin');
  const [creating, setCreating] = useState(false);
  const [actingId, setActingId] = useState(null);
  const [refreshing, startRefresh] = useTransition();

  const users = initialUsers;

  function reload() {
    startRefresh(() => router.refresh());
  }

  async function createUser(event) {
    event.preventDefault();
    setCreating(true);

    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account, display_name: displayName, role }),
    });
    const json = await res.json();
    setCreating(false);

    if (!res.ok) {
      toast(json.error || '建立失敗', 'error');
      return;
    }

    toast(`已建立 ${displayName}，帳號與初始密碼皆為「${json.account}」`, 'success', 8000);
    setAccount('');
    setDisplayName('');
    reload();
  }

  async function act(user, body, confirmConfig) {
    if (confirmConfig) {
      const agreed = await confirm(confirmConfig);
      if (!agreed) return;
    }

    setActingId(user.id);
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: body === 'delete' ? 'DELETE' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: body === 'delete' ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setActingId(null);

    if (!res.ok) {
      toast(json.error || '操作失敗', 'error');
      return;
    }

    if (json.initial_password) {
      toast(
        `已將 ${user.display_name} 的密碼重設為「${json.initial_password}」，對方下次登入需重新設定。`,
        'success',
        8000
      );
    } else {
      toast('已更新', 'success');
    }
    reload();
  }

  const canManage = (user) => {
    if (me.role === 'admin') return user.id !== me.id;
    return user.role === 'checkin' && user.created_by === me.id;
  };

  return (
    <>
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
                  placeholder="例：fx0001"
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

              <Button type="submit" variant="primary" loading={creating}>
                建立帳號
              </Button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <h3>
          帳號列表（{users.length}）
          {refreshing && <Spinner size="sm" className="spinner-inline" />}
        </h3>

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
                {users.map((user) => {
                  const busy = actingId === user.id;
                  return (
                    <tr key={user.id}>
                      <td>{user.account}</td>
                      <td>{user.display_name}</td>
                      <td>
                        {me.role === 'admin' && user.id !== me.id ? (
                          <select
                            className="input-sm"
                            value={user.role}
                            disabled={busy}
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
                        {!user.is_active ? (
                          <span className="badge">已停用</span>
                        ) : user.must_change_password ? (
                          <span className="badge badge-warning">待首次登入</span>
                        ) : (
                          <span className="badge badge-success">使用中</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {canManage(user) && (
                          <span style={{ display: 'inline-flex', gap: 6 }}>
                            <Button
                              size="sm"
                              loading={busy}
                              onClick={() =>
                                act(
                                  user,
                                  { action: 'reset_password' },
                                  {
                                    title: '重設密碼',
                                    description: `將 ${user.display_name} 的密碼重設為帳號「${user.account}」，對方下次登入時必須重新設定。`,
                                    confirmLabel: '重設',
                                  }
                                )
                              }
                            >
                              重設密碼
                            </Button>
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                act(user, { action: 'set_active', is_active: !user.is_active })
                              }
                            >
                              {user.is_active ? '停用' : '啟用'}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={busy}
                              onClick={() =>
                                act(user, 'delete', {
                                  title: '刪除帳號',
                                  description: `刪除 ${user.display_name}（${user.account}）？此操作無法復原。`,
                                  confirmLabel: '刪除',
                                  variant: 'destructive',
                                })
                              }
                            >
                              刪除
                            </Button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
