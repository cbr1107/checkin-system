'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { atLeast } from '@/lib/constants';
import ImportWizard from './ImportWizard';
import Busy from '../../Busy';

function toLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SubEventDetail({
  profile,
  event,
  registrations,
  batches,
  grants,
  staffUsers,
  canEdit,
}) {
  const router = useRouter();
  const isLead = atLeast(profile.role, 'lead');

  const [form, setForm] = useState({
    name: event.name,
    location: event.location || '',
    description: event.description || '',
    starts_at: toLocalInput(event.starts_at),
    ends_at: toLocalInput(event.ends_at),
    require_checkout: event.require_checkout,
    min_stay_minutes: event.min_stay_minutes,
    is_active: event.is_active,
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [keyword, setKeyword] = useState('');

  const teams = useMemo(() => {
    const set = new Set(registrations.map((r) => r.team).filter(Boolean));
    return [...set].sort();
  }, [registrations]);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return registrations;
    return registrations.filter(
      (r) =>
        r.participants?.name?.toLowerCase().includes(k) ||
        r.participants?.code?.toLowerCase().includes(k) ||
        (r.team || '').toLowerCase().includes(k)
    );
  }, [registrations, keyword]);

  function update(patch) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  async function saveSettings(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);

    const supabase = createClient();
    const { error: updateError } = await supabase
      .from('sub_events')
      .update({
        name: form.name.trim(),
        location: form.location.trim() || null,
        description: form.description.trim() || null,
        starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
        ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
        require_checkout: form.require_checkout,
        min_stay_minutes: Number(form.min_stay_minutes) || 0,
        is_active: form.is_active,
      })
      .eq('id', event.id);

    setBusy(false);
    if (updateError) setError(updateError.message);
    else {
      setMessage('設定已儲存。');
      router.refresh();
    }
  }

  async function removeEvent() {
    if (
      !window.confirm(
        `刪除「${event.name}」？名單與報到紀錄會一併刪除，此操作無法復原。`
      )
    )
      return;

    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from('sub_events')
      .delete()
      .eq('id', event.id);
    if (deleteError) setError(deleteError.message);
    else router.push('/sub-events');
  }

  async function removeRegistration(row) {
    if (!window.confirm(`把 ${row.participants?.name} 移出這個子活動的名單？`)) return;

    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from('registrations')
      .delete()
      .eq('id', row.id);
    if (deleteError) setError(deleteError.message);
    else router.refresh();
  }

  async function updateTeam(row, team) {
    const supabase = createClient();
    await supabase
      .from('registrations')
      .update({ team: team.trim() || null })
      .eq('id', row.id);
    router.refresh();
  }

  async function undoBatch(batch) {
    if (
      !window.confirm(
        `復原這次匯入？會移除該批次帶進來的 ${batch.created_count} 筆名單（已報到者也會被移除）。`
      )
    )
      return;

    const supabase = createClient();
    await supabase.from('registrations').delete().eq('import_batch_id', batch.id);
    await supabase
      .from('import_batches')
      .update({ undone_at: new Date().toISOString(), undone_by: profile.id })
      .eq('id', batch.id);
    router.refresh();
  }

  async function addGrant(userId) {
    if (!userId) return;
    const supabase = createClient();
    const { error: grantError } = await supabase.from('sub_event_grants').insert({
      sub_event_id: event.id,
      user_id: userId,
      can_edit_roster: true,
      granted_by: profile.id,
    });
    if (grantError) setError(grantError.message);
    else router.refresh();
  }

  async function removeGrant(grantId) {
    const supabase = createClient();
    await supabase.from('sub_event_grants').delete().eq('id', grantId);
    router.refresh();
  }

  const grantedIds = new Set(grants.map((g) => g.user_id));

  return (
    <main className="page">
      <div className="page-head">
        <h1>{event.name}</h1>
        <p>
          名單 {registrations.length} 人
          {teams.length > 0 && ` · ${teams.length} 個組別`}
          {event.require_checkout ? ' · 需要簽退' : ''}
        </p>
      </div>

      <Busy show={busy} label="儲存中…" />

      {error && <div className="notice notice-error">{error}</div>}
      {message && <div className="notice notice-ok">{message}</div>}

      {isLead && (
        <div className="card">
          <h3>活動設定</h3>
          <form onSubmit={saveSettings}>
            <div className="row">
              <label className="field">
                <span>名稱</span>
                <input
                  value={form.name}
                  onChange={(e) => update({ name: e.target.value })}
                  required
                />
              </label>
              <label className="field">
                <span>地點</span>
                <input
                  value={form.location}
                  onChange={(e) => update({ location: e.target.value })}
                />
              </label>
            </div>

            <div className="row" style={{ marginTop: 16 }}>
              <label className="field">
                <span>開始時間</span>
                <input
                  type="datetime-local"
                  value={form.starts_at}
                  onChange={(e) => update({ starts_at: e.target.value })}
                />
              </label>
              <label className="field">
                <span>結束時間</span>
                <input
                  type="datetime-local"
                  value={form.ends_at}
                  onChange={(e) => update({ ends_at: e.target.value })}
                />
              </label>
            </div>

            <div className="row" style={{ marginTop: 16, alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={form.require_checkout}
                  onChange={(e) => update({ require_checkout: e.target.checked })}
                  style={{ width: 16 }}
                />
                需要簽退
              </label>

              {form.require_checkout && (
                <label className="field" style={{ maxWidth: 220 }}>
                  <span>最短停留（分鐘，未達會跳確認）</span>
                  <input
                    type="number"
                    min="0"
                    value={form.min_stay_minutes}
                    onChange={(e) => update({ min_stay_minutes: e.target.value })}
                  />
                </label>
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => update({ is_active: e.target.checked })}
                  style={{ width: 16 }}
                />
                進行中
              </label>
            </div>

            <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
              <button className="btn-primary" disabled={busy}>
                {busy ? '儲存中…' : '儲存設定'}
              </button>
              <button type="button" className="btn-danger" onClick={removeEvent}>
                刪除子活動
              </button>
            </div>
          </form>
        </div>
      )}

      {canEdit && <ImportWizard subEventId={event.id} />}

      <div className="card">
        <h3>名單（{filtered.length}／{registrations.length}）</h3>

        <div className="row" style={{ marginBottom: 16 }}>
          <label className="field">
            <span>搜尋姓名、編號或組別</span>
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          </label>
        </div>

        {registrations.length === 0 ? (
          <div className="empty">名單是空的。用上面的匯入把 Excel 帶進來。</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>編號</th>
                  <th>姓名</th>
                  <th>組別</th>
                  <th>QR 內容</th>
                  <th>狀態</th>
                  {canEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 500).map((row) => (
                  <tr key={row.id}>
                    <td>{row.participants?.code}</td>
                    <td>{row.participants?.name}</td>
                    <td>
                      {canEdit ? (
                        <input
                          defaultValue={row.team || ''}
                          onBlur={(e) => {
                            if (e.target.value !== (row.team || '')) {
                              updateTeam(row, e.target.value);
                            }
                          }}
                          style={{ maxWidth: 120, padding: '4px 8px' }}
                        />
                      ) : (
                        row.team || '—'
                      )}
                    </td>
                    <td style={{ color: 'var(--muted)' }}>{row.participants?.qr_code}</td>
                    <td>
                      {row.checked_out_at
                        ? '已簽退'
                        : row.checked_in_at
                          ? '已報到'
                          : '未報到'}
                    </td>
                    {canEdit && (
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="btn-quiet btn-sm"
                          onClick={() => removeRegistration(row)}
                        >
                          移除
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 500 && (
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>
                為維持頁面速度，只顯示前 500 筆。請用搜尋縮小範圍。
              </p>
            )}
          </div>
        )}
      </div>

      {batches.length > 0 && (
        <div className="card">
          <h3>匯入紀錄</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>時間</th>
                  <th>檔案</th>
                  <th>新增</th>
                  <th>更新</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.id}>
                    <td>{new Date(batch.created_at).toLocaleString('zh-TW')}</td>
                    <td>{batch.filename || '—'}</td>
                    <td>{batch.created_count}</td>
                    <td>{batch.updated_count}</td>
                    <td style={{ textAlign: 'right' }}>
                      {batch.undone_at ? (
                        <span style={{ color: 'var(--muted)' }}>已復原</span>
                      ) : (
                        canEdit && (
                          <button
                            className="btn-quiet btn-sm"
                            onClick={() => undoBatch(batch)}
                          >
                            復原這批
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isLead && (
        <div className="card">
          <h3>授權註冊組員管理名單</h3>

          {grants.length === 0 ? (
            <p style={{ color: 'var(--muted)', marginTop: 0 }}>
              目前沒有授權任何組員。只有註冊長以上能編輯這份名單。
            </p>
          ) : (
            <div className="table-wrap" style={{ marginBottom: 16 }}>
              <table>
                <thead>
                  <tr>
                    <th>姓名</th>
                    <th>帳號</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {grants.map((grant) => (
                    <tr key={grant.id}>
                      <td>{grant.app_users?.display_name}</td>
                      <td>{grant.app_users?.account}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="btn-quiet btn-sm"
                          onClick={() => removeGrant(grant.id)}
                        >
                          取消授權
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <label className="field" style={{ maxWidth: 280 }}>
            <span>加入註冊組員</span>
            <select
              value=""
              onChange={(e) => {
                addGrant(e.target.value);
                e.target.value = '';
              }}
            >
              <option value="">選擇組員…</option>
              {staffUsers
                .filter((u) => !grantedIds.has(u.id))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.display_name}（{u.account}）
                  </option>
                ))}
            </select>
          </label>
        </div>
      )}
    </main>
  );
}
