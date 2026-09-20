'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { atLeast } from '@/lib/constants';
import { compareTeams } from '@/lib/attendance';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Switch from '@/components/ui/Switch';
import Busy from '@/components/ui/Busy';
import { useToast, useConfirm } from '@/components/ui/UiProvider';
import ImportWizard from './ImportWizard';

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
  const toast = useToast();
  const confirm = useConfirm();
  const isLead = atLeast(profile.role, 'lead');

  const [form, setForm] = useState({
    name: event.name,
    location: event.location || '',
    starts_at: toLocalInput(event.starts_at),
    ends_at: toLocalInput(event.ends_at),
    require_checkout: event.require_checkout,
    min_stay_minutes: event.min_stay_minutes,
    is_active: event.is_active,
  });
  const [saving, setSaving] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [rowBusy, setRowBusy] = useState(null);
  const [keyword, setKeyword] = useState('');
  const [refreshing, startRefresh] = useTransition();

  const reload = () => startRefresh(() => router.refresh());

  const teams = useMemo(() => {
    const set = new Set(registrations.map((r) => r.team).filter(Boolean));
    return [...set].sort(compareTeams);
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
    setSaving(true);

    const supabase = createClient();
    const { error } = await supabase
      .from('sub_events')
      .update({
        name: form.name.trim(),
        location: form.location.trim() || null,
        starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
        ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
        require_checkout: form.require_checkout,
        min_stay_minutes: Number(form.min_stay_minutes) || 0,
        is_active: form.is_active,
      })
      .eq('id', event.id);

    setSaving(false);
    if (error) toast(error.message, 'error');
    else {
      toast('設定已儲存', 'success');
      reload();
    }
  }

  async function removeEvent() {
    const agreed = await confirm({
      title: '刪除子活動',
      description: `刪除「${event.name}」？名單與報到紀錄會一併刪除，此操作無法復原。`,
      confirmLabel: '刪除',
      variant: 'destructive',
    });
    if (!agreed) return;

    setBusyLabel('刪除中…');
    const supabase = createClient();
    const { error } = await supabase.from('sub_events').delete().eq('id', event.id);
    setBusyLabel('');

    if (error) toast(error.message, 'error');
    else router.push('/sub-events');
  }

  async function removeRegistration(row) {
    const agreed = await confirm({
      title: '移出名單',
      description: `把 ${row.participants?.name} 移出「${event.name}」的名單？`,
      confirmLabel: '移除',
      variant: 'destructive',
    });
    if (!agreed) return;

    setRowBusy(row.id);
    const supabase = createClient();
    const { error } = await supabase.from('registrations').delete().eq('id', row.id);
    setRowBusy(null);

    if (error) toast(error.message, 'error');
    else reload();
  }

  async function updateTeam(row, team) {
    setRowBusy(row.id);
    const supabase = createClient();
    const { error } = await supabase
      .from('registrations')
      .update({ team: team.trim() || null })
      .eq('id', row.id);
    setRowBusy(null);

    if (error) toast(error.message, 'error');
    else reload();
  }

  async function undoBatch(batch) {
    const agreed = await confirm({
      title: '復原這次匯入',
      description: `會移除該批次帶進來的 ${batch.created_count} 筆名單，已報到者也會被移除。`,
      confirmLabel: '復原',
      variant: 'destructive',
    });
    if (!agreed) return;

    setBusyLabel('復原匯入…');
    const supabase = createClient();
    await supabase.from('registrations').delete().eq('import_batch_id', batch.id);
    await supabase
      .from('import_batches')
      .update({ undone_at: new Date().toISOString(), undone_by: profile.id })
      .eq('id', batch.id);
    setBusyLabel('');
    toast('已復原這批匯入', 'success');
    reload();
  }

  async function addGrant(userId) {
    if (!userId) return;
    setBusyLabel('設定授權…');
    const supabase = createClient();
    const { error } = await supabase.from('sub_event_grants').insert({
      sub_event_id: event.id,
      user_id: userId,
      can_edit_roster: true,
      granted_by: profile.id,
    });
    setBusyLabel('');

    if (error) toast(error.message, 'error');
    else {
      toast('已授權', 'success');
      reload();
    }
  }

  async function removeGrant(grantId) {
    setBusyLabel('取消授權…');
    const supabase = createClient();
    await supabase.from('sub_event_grants').delete().eq('id', grantId);
    setBusyLabel('');
    toast('已取消授權', 'success');
    reload();
  }

  const grantedIds = new Set(grants.map((g) => g.user_id));

  return (
    <main className="page">
      <Busy show={Boolean(busyLabel)} label={busyLabel} />

      <div className="page-head">
        <h1>{event.name}</h1>
        <p>
          名單 {registrations.length} 人
          {teams.length > 0 && ` · ${teams.length} 個組別`}
          {event.require_checkout ? ' · 需要簽退' : ''}
        </p>
      </div>

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

            <div className="row" style={{ marginTop: 14 }}>
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
              <Switch
                checked={form.require_checkout}
                onChange={(v) => update({ require_checkout: v })}
              >
                需要簽退
              </Switch>

              {form.require_checkout && (
                <label className="field" style={{ maxWidth: 240 }}>
                  <span>最短停留（分鐘，未達會跳確認）</span>
                  <input
                    type="number"
                    min="0"
                    value={form.min_stay_minutes}
                    onChange={(e) => update({ min_stay_minutes: e.target.value })}
                  />
                </label>
              )}

              <Switch checked={form.is_active} onChange={(v) => update({ is_active: v })}>
                進行中
              </Switch>
            </div>

            <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
              <Button type="submit" variant="primary" loading={saving}>
                儲存設定
              </Button>
              <Button variant="destructive" onClick={removeEvent}>
                刪除子活動
              </Button>
            </div>
          </form>
        </div>
      )}

      {canEdit && <ImportWizard subEventId={event.id} />}

      <div className="card">
        <h3>
          名單（{filtered.length}／{registrations.length}）
          {refreshing && <Spinner size="sm" className="spinner-inline" />}
        </h3>

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
                          className="input-sm"
                          defaultValue={row.team || ''}
                          disabled={rowBusy === row.id}
                          onBlur={(e) => {
                            if (e.target.value !== (row.team || '')) {
                              updateTeam(row, e.target.value);
                            }
                          }}
                          style={{ maxWidth: 120 }}
                        />
                      ) : (
                        row.team || '—'
                      )}
                    </td>
                    <td style={{ color: 'var(--muted-foreground)' }}>
                      {row.participants?.qr_code}
                    </td>
                    <td>
                      {row.checked_out_at ? (
                        <span className="badge badge-info">已簽退</span>
                      ) : row.checked_in_at ? (
                        <span className="badge badge-success">已報到</span>
                      ) : (
                        <span className="badge">未報到</span>
                      )}
                    </td>
                    {canEdit && (
                      <td style={{ textAlign: 'right' }}>
                        <Button
                          size="sm"
                          loading={rowBusy === row.id}
                          onClick={() => removeRegistration(row)}
                        >
                          移除
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
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
                        <span className="badge">已復原</span>
                      ) : (
                        canEdit && (
                          <Button size="sm" onClick={() => undoBatch(batch)}>
                            復原這批
                          </Button>
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
            <div className="empty">目前沒有授權任何組員。</div>
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
                        <Button size="sm" onClick={() => removeGrant(grant.id)}>
                          取消授權
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <label className="field" style={{ maxWidth: 300 }}>
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
