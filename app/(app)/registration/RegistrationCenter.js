'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { atLeast } from '@/lib/constants';
import { compareTeams } from '@/lib/attendance';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Switch from '@/components/ui/Switch';
import Busy from '@/components/ui/Busy';
import Skeleton from '@/components/ui/Skeleton';
import Modal from '@/components/ui/Modal';
import { useToast, useConfirm } from '@/components/ui/UiProvider';
import ImportWizard from '../sub-events/[id]/ImportWizard';

const ROSTER_SELECT =
  'id, team, checked_in_at, participants(id, code, name, qr_code)';

function toLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function RegistrationCenter({ profile, initialEvents, staffUsers }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const isLead = atLeast(profile.role, 'lead');

  const [events, setEvents] = useState(initialEvents);
  const [eventId, setEventId] = useState(initialEvents[0]?.id || '');
  const [roster, setRoster] = useState([]);
  const [grants, setGrants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyLabel, setBusyLabel] = useState('');

  const [creating, setCreating] = useState(false);
  const [newEvent, setNewEvent] = useState({ name: '', location: '', starts_at: '' });

  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [batchTeam, setBatchTeam] = useState('');

  const [manual, setManual] = useState({ code: '', name: '', team: '', qr_code: '' });
  const [adding, setAdding] = useState(false);

  const [modal, setModal] = useState(null);
  const [copySource, setCopySource] = useState('');
  const [copyTeam, setCopyTeam] = useState(true);

  const event = events.find((e) => e.id === eventId) || null;

  useEffect(() => {
    if (!event) return;
    setForm({
      name: event.name,
      location: event.location || '',
      starts_at: toLocalInput(event.starts_at),
      ends_at: toLocalInput(event.ends_at),
      require_checkout: event.require_checkout,
      min_stay_minutes: event.min_stay_minutes,
      open_to_all_staff: event.open_to_all_staff,
      is_active: event.is_active,
    });
  }, [event]);

  const load = useCallback(async () => {
    if (!eventId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();

    const [rosterRes, grantRes] = await Promise.all([
      supabase.from('registrations').select(ROSTER_SELECT).eq('sub_event_id', eventId).limit(2000),
      supabase
        .from('sub_event_grants')
        // sub_event_grants 有 user_id 與 granted_by 兩個欄位指向 app_users，
        // 必須指定用哪一個外鍵，否則整個查詢會失敗
        .select(
          'id, user_id, app_users!sub_event_grants_user_id_fkey(display_name, account)'
        )
        .eq('sub_event_id', eventId),
    ]);

    if (rosterRes.error) toast(rosterRes.error.message, 'error');
    if (grantRes.error) toast(`讀取授權清單失敗：${grantRes.error.message}`, 'error');
    setRoster(rosterRes.data || []);
    setGrants(grantRes.data || []);
    setSelected(new Set());
    setLoading(false);
  }, [eventId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  /* ---------------- 準備進度 ---------------- */
  const checks = useMemo(() => {
    if (!event) return [];

    const noTeam = roster.filter((r) => !r.team).length;
    const qrSeen = new Map();
    let dupQr = 0;
    let missingQr = 0;
    for (const r of roster) {
      const qr = r.participants?.qr_code;
      if (!qr) missingQr += 1;
      else {
        if (qrSeen.has(qr)) dupQr += 1;
        qrSeen.set(qr, true);
      }
    }

    const operators = event.open_to_all_staff ? '全部組員' : `${grants.length} 位組員`;

    return [
      {
        key: 'basic',
        label: '活動基本資料',
        ok: Boolean(event.name && event.starts_at),
        detail: event.starts_at
          ? new Date(event.starts_at).toLocaleString('zh-TW')
          : '尚未設定開始時間',
      },
      {
        key: 'roster',
        label: '名單已匯入',
        ok: roster.length > 0,
        detail: `${roster.length} 人`,
      },
      {
        key: 'team',
        label: '組別已分配',
        ok: roster.length > 0 && noTeam === 0,
        detail: noTeam === 0 ? '全部已分組' : `${noTeam} 人未分組`,
        action: noTeam > 0 ? () => setKeyword('__noteam__') : null,
      },
      {
        key: 'qr',
        label: 'QR 內容完整',
        ok: roster.length > 0 && dupQr === 0 && missingQr === 0,
        detail:
          dupQr || missingQr
            ? `${dupQr} 筆重複、${missingQr} 筆缺漏`
            : '沒有重複或缺漏',
      },
      {
        key: 'operator',
        label: '可操作名單的組員',
        ok: true,
        detail: operators,
      },
      {
        key: 'checkout',
        label: '簽退設定',
        ok: true,
        detail: event.require_checkout
          ? `需要簽退，最短停留 ${event.min_stay_minutes} 分鐘`
          : '不需簽退',
      },
    ];
  }, [event, roster, grants]);

  const filtered = useMemo(() => {
    if (keyword === '__noteam__') return roster.filter((r) => !r.team);
    const k = keyword.trim().toLowerCase();
    if (!k) return roster;
    return roster.filter(
      (r) =>
        r.participants?.name?.toLowerCase().includes(k) ||
        r.participants?.code?.toLowerCase().includes(k) ||
        (r.team || '').toLowerCase().includes(k)
    );
  }, [roster, keyword]);

  const shown = filtered.slice(0, 400);

  /* ---------------- 動作 ---------------- */
  async function createEvent(e) {
    e.preventDefault();
    setCreating(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from('sub_events')
      .insert({
        name: newEvent.name.trim(),
        location: newEvent.location.trim() || null,
        starts_at: newEvent.starts_at ? new Date(newEvent.starts_at).toISOString() : null,
      })
      .select('*')
      .single();
    setCreating(false);

    if (error) {
      toast(error.message, 'error');
      return;
    }
    setEvents((prev) => [data, ...prev]);
    setEventId(data.id);
    setNewEvent({ name: '', location: '', starts_at: '' });
    toast(`已建立「${data.name}」`, 'success');
  }

  async function saveSettings(e) {
    e.preventDefault();
    setSaving(true);
    const supabase = createClient();
    const patch = {
      name: form.name.trim(),
      location: form.location.trim() || null,
      starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      require_checkout: form.require_checkout,
      min_stay_minutes: Number(form.min_stay_minutes) || 0,
      open_to_all_staff: form.open_to_all_staff,
      is_active: form.is_active,
    };
    const { error } = await supabase.from('sub_events').update(patch).eq('id', eventId);
    setSaving(false);

    if (error) {
      toast(error.message, 'error');
      return;
    }
    setEvents((prev) => prev.map((ev) => (ev.id === eventId ? { ...ev, ...patch } : ev)));
    toast('已儲存', 'success');
  }

  async function addOne(e) {
    e.preventDefault();
    setAdding(true);
    const res = await fetch(`/api/sub-events/${eventId}/participants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manual),
    });
    const json = await res.json();
    setAdding(false);

    if (!res.ok) {
      toast(json.error || '新增失敗', 'error');
      return;
    }
    toast(`已加入 ${manual.name}`, 'success');
    setManual({ code: '', name: '', team: '', qr_code: '' });
    load();
  }

  async function copyRoster() {
    if (!copySource) return;
    setBusyLabel('複製名單…');
    const res = await fetch(`/api/sub-events/${eventId}/copy-roster`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_id: copySource, include_team: copyTeam }),
    });
    const json = await res.json();
    setBusyLabel('');

    if (!res.ok) {
      toast(json.error || '複製失敗', 'error');
      return;
    }
    toast(`已複製：新增 ${json.created} 人、更新 ${json.updated} 人`, 'success');
    load();
  }

  async function applyBatchTeam() {
    if (selected.size === 0) return;
    setBusyLabel('套用組別…');
    const supabase = createClient();
    const { error } = await supabase
      .from('registrations')
      .update({ team: batchTeam.trim() || null })
      .in('id', [...selected]);
    setBusyLabel('');

    if (error) {
      toast(error.message, 'error');
      return;
    }
    toast(`已更新 ${selected.size} 筆`, 'success');
    setBatchTeam('');
    load();
  }

  async function updateTeam(row, team) {
    const supabase = createClient();
    const { error } = await supabase
      .from('registrations')
      .update({ team: team.trim() || null })
      .eq('id', row.id);
    if (error) toast(error.message, 'error');
    else
      setRoster((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, team: team.trim() || null } : r))
      );
  }

  async function removeSelected() {
    const agreed = await confirm({
      title: '移出名單',
      description: `把勾選的 ${selected.size} 人移出「${event.name}」？`,
      confirmLabel: '移除',
      variant: 'destructive',
    });
    if (!agreed) return;

    setBusyLabel('移除中…');
    const supabase = createClient();
    await supabase.from('registrations').delete().in('id', [...selected]);
    setBusyLabel('');
    toast('已移除', 'success');
    load();
  }

  async function addGrant(userId) {
    if (!userId) return;
    const supabase = createClient();
    const { error } = await supabase.from('sub_event_grants').upsert(
      {
        sub_event_id: eventId,
        user_id: userId,
        can_edit_roster: true,
        granted_by: profile.id,
      },
      { onConflict: 'sub_event_id,user_id' }
    );
    if (error) toast(error.message, 'error');
    else {
      toast('已授權', 'success');
      load();
    }
  }

  async function removeGrant(id) {
    const supabase = createClient();
    await supabase.from('sub_event_grants').delete().eq('id', id);
    toast('已取消授權', 'success');
    load();
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === shown.length ? new Set() : new Set(shown.map((r) => r.id))
    );
  }

  function toggleOne(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function copyLink() {
    const url = `${window.location.origin}/checkin/${eventId}`;
    navigator.clipboard?.writeText(url).then(
      () => toast('報到連結已複製', 'success'),
      () => toast(url, 'info', 10000)
    );
  }

  function printRoster() {
    const rows = [...roster].sort(
      (a, b) =>
        compareTeams(a.team || '未分組', b.team || '未分組') ||
        (a.participants?.code || '').localeCompare(b.participants?.code || '', 'zh-Hant', {
          numeric: true,
        })
    );

    const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<title>${event.name} 紙本報到清單</title>
<style>
  body { font-family: "Microsoft JhengHei", sans-serif; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p { color: #555; font-size: 12px; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; }
  th { background: #eee; }
  td.sign { width: 120px; }
  @media print { @page { margin: 12mm; } }
</style></head><body>
<h1>${event.name}　紙本報到清單</h1>
<p>共 ${rows.length} 人　列印時間：${new Date().toLocaleString('zh-TW')}</p>
<table><thead><tr><th>組別</th><th>編號</th><th>姓名</th><th class="sign">報到簽名</th>${
      event.require_checkout ? '<th class="sign">簽退簽名</th>' : ''
    }</tr></thead><tbody>
${rows
  .map(
    (r) =>
      `<tr><td>${r.team || ''}</td><td>${r.participants?.code || ''}</td><td>${
        r.participants?.name || ''
      }</td><td></td>${event.require_checkout ? '<td></td>' : ''}</tr>`
  )
  .join('')}
</tbody></table></body></html>`;

    const win = window.open('', '_blank');
    if (!win) {
      toast('瀏覽器擋住了新視窗，請允許彈出視窗後再試', 'error');
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  }

  const grantedIds = new Set(grants.map((g) => g.user_id));

  return (
    <>
      <Busy show={Boolean(busyLabel)} label={busyLabel} />

      <div className="page-head page-head-row">
        <h1>註冊作業中心</h1>
        {event && (
          <div className="head-actions">
            <Button onClick={() => setModal('start')}>報到準備</Button>
            {isLead && (
              <Button onClick={() => setModal('staff')}>
                組員權限設定
                {event.open_to_all_staff
                  ? '（全部）'
                  : grants.length > 0
                    ? `（${grants.length}）`
                    : ''}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* 活動選擇 */}
      <div className="card">
        <h3>子活動</h3>
        <div className="row">
          <label className="field">
            <span>目前作業的活動</span>
            <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
              {events.length === 0 && <option value="">尚無子活動</option>}
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                  {ev.is_active ? '' : '（已封存）'}
                </option>
              ))}
            </select>
          </label>
        </div>

        {isLead && (
          <form onSubmit={createEvent} className="row" style={{ marginTop: 18 }}>
            <label className="field">
              <span>新建活動名稱</span>
              <input
                value={newEvent.name}
                onChange={(e) => setNewEvent({ ...newEvent, name: e.target.value })}
                placeholder="例：夜烤"
                required
              />
            </label>
            <label className="field">
              <span>地點</span>
              <input
                value={newEvent.location}
                onChange={(e) => setNewEvent({ ...newEvent, location: e.target.value })}
              />
            </label>
            <label className="field">
              <span>開始時間</span>
              <input
                type="datetime-local"
                value={newEvent.starts_at}
                onChange={(e) => setNewEvent({ ...newEvent, starts_at: e.target.value })}
              />
            </label>
            <Button type="submit" variant="primary" loading={creating}>
              建立
            </Button>
          </form>
        )}
      </div>

      {!event ? null : (
        <>
          {/* 準備進度 */}
          <div className="card">
            <h3>
              準備進度
              {loading && <Spinner size="sm" className="spinner-inline" />}
            </h3>

            {loading ? (
              <div className="skeleton-stack">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} height={34} />
                ))}
              </div>
            ) : (
              <ul className="checklist">
                {checks.map((check) => (
                  <li key={check.key} className={check.ok ? 'ok' : 'todo'}>
                    <span className="check-mark" aria-hidden="true">
                      {check.ok ? '✓' : '!'}
                    </span>
                    <span className="check-label">{check.label}</span>
                    <span className="check-detail">{check.detail}</span>
                    {check.action && (
                      <Button size="sm" onClick={check.action}>
                        篩出
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 活動設定 */}
          {isLead && form && (
            <div className="card">
              <h3>活動設定</h3>
              <form onSubmit={saveSettings}>
                <div className="row">
                  <label className="field">
                    <span>名稱</span>
                    <input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      required
                    />
                  </label>
                  <label className="field">
                    <span>地點</span>
                    <input
                      value={form.location}
                      onChange={(e) => setForm({ ...form, location: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>開始時間</span>
                    <input
                      type="datetime-local"
                      value={form.starts_at}
                      onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>結束時間</span>
                    <input
                      type="datetime-local"
                      value={form.ends_at}
                      onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
                    />
                  </label>
                </div>

                <div className="row" style={{ marginTop: 18, alignItems: 'center' }}>
                  <Switch
                    checked={form.require_checkout}
                    onChange={(v) => setForm({ ...form, require_checkout: v })}
                  >
                    需要簽退
                  </Switch>

                  {form.require_checkout && (
                    <label className="field" style={{ maxWidth: 210 }}>
                      <span>最短停留（分鐘）</span>
                      <input
                        type="number"
                        min="0"
                        value={form.min_stay_minutes}
                        onChange={(e) =>
                          setForm({ ...form, min_stay_minutes: e.target.value })
                        }
                      />
                    </label>
                  )}

                  <Switch
                    checked={form.is_active}
                    onChange={(v) => setForm({ ...form, is_active: v })}
                  >
                    進行中
                  </Switch>
                </div>

                <div style={{ marginTop: 20 }}>
                  <Button type="submit" variant="primary" loading={saving}>
                    儲存設定
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* 名單來源 */}
          <ImportWizard subEventId={eventId} />

          <div className="card">
            <h3>其他名單來源</h3>

            <div className="row">
              <label className="field">
                <span>從其他子活動複製</span>
                <select value={copySource} onChange={(e) => setCopySource(e.target.value)}>
                  <option value="">選擇來源活動…</option>
                  {events
                    .filter((ev) => ev.id !== eventId)
                    .map((ev) => (
                      <option key={ev.id} value={ev.id}>
                        {ev.name}
                      </option>
                    ))}
                </select>
              </label>
              <div style={{ paddingBottom: 9 }}>
                <Switch checked={copyTeam} onChange={setCopyTeam}>
                  一併帶入組別
                </Switch>
              </div>
              <Button onClick={copyRoster} disabled={!copySource}>
                複製名單
              </Button>
            </div>

            <form onSubmit={addOne} className="row" style={{ marginTop: 20 }}>
              <label className="field">
                <span>單筆加入 · 編號</span>
                <input
                  value={manual.code}
                  onChange={(e) => setManual({ ...manual, code: e.target.value })}
                  required
                />
              </label>
              <label className="field">
                <span>姓名</span>
                <input
                  value={manual.name}
                  onChange={(e) => setManual({ ...manual, name: e.target.value })}
                  required
                />
              </label>
              <label className="field">
                <span>組別</span>
                <input
                  value={manual.team}
                  onChange={(e) => setManual({ ...manual, team: e.target.value })}
                />
              </label>
              <label className="field">
                <span>QR 內容（留空同編號）</span>
                <input
                  value={manual.qr_code}
                  onChange={(e) => setManual({ ...manual, qr_code: e.target.value })}
                />
              </label>
              <Button type="submit" loading={adding}>
                加入
              </Button>
            </form>
          </div>

          {/* 名單 */}
          <div className="card">
            <h3>
              名單（{filtered.length}／{roster.length}）
              {loading && <Spinner size="sm" className="spinner-inline" />}
            </h3>

            <div className="row" style={{ marginBottom: 14 }}>
              <label className="field">
                <span>搜尋姓名、編號或組別</span>
                <input
                  value={keyword === '__noteam__' ? '' : keyword}
                  placeholder={keyword === '__noteam__' ? '目前只顯示未分組' : ''}
                  onChange={(e) => setKeyword(e.target.value)}
                />
              </label>
              {keyword === '__noteam__' && (
                <Button onClick={() => setKeyword('')}>顯示全部</Button>
              )}
            </div>

            {selected.size > 0 && (
              <div className="row batch-bar">
                <span>已勾選 {selected.size} 人</span>
                <label className="field" style={{ maxWidth: 180 }}>
                  <span>指定組別</span>
                  <input
                    value={batchTeam}
                    onChange={(e) => setBatchTeam(e.target.value)}
                    placeholder="留空表示清除組別"
                  />
                </label>
                <Button variant="primary" onClick={applyBatchTeam}>
                  套用
                </Button>
                <Button variant="destructive" onClick={removeSelected}>
                  移出名單
                </Button>
                <Button variant="ghost" onClick={() => setSelected(new Set())}>
                  取消勾選
                </Button>
              </div>
            )}

            {roster.length === 0 ? (
              <div className="empty">名單是空的</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>
                        <input
                          type="checkbox"
                          checked={shown.length > 0 && selected.size === shown.length}
                          onChange={toggleAll}
                          aria-label="全選"
                        />
                      </th>
                      <th>編號</th>
                      <th>姓名</th>
                      <th>組別</th>
                      <th>QR 內容</th>
                      <th>狀態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.has(row.id)}
                            onChange={() => toggleOne(row.id)}
                            aria-label={`選取 ${row.participants?.name}`}
                          />
                        </td>
                        <td>{row.participants?.code}</td>
                        <td>{row.participants?.name}</td>
                        <td>
                          <input
                            className="input-sm"
                            defaultValue={row.team || ''}
                            style={{ maxWidth: 110 }}
                            onBlur={(e) => {
                              if (e.target.value !== (row.team || '')) {
                                updateTeam(row, e.target.value);
                              }
                            }}
                          />
                        </td>
                        <td style={{ color: 'var(--muted-foreground)' }}>
                          {row.participants?.qr_code}
                        </td>
                        <td>
                          {row.checked_in_at ? (
                            <span className="badge badge-success">已報到</span>
                          ) : (
                            <span className="badge">未報到</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered.length > shown.length && (
                  <div className="empty">另有 {filtered.length - shown.length} 筆未顯示</div>
                )}
              </div>
            )}
          </div>

        </>
      )}

      {/* 可操作的註冊組員 */}
      <Modal
        open={modal === 'staff'}
        title="組員權限設定"
        onClose={() => setModal(null)}
        size="lg"
      >
        <div style={{ marginBottom: 18 }}>
          <Switch
            checked={form?.open_to_all_staff || false}
            onChange={async (v) => {
              setForm({ ...form, open_to_all_staff: v });
              const supabase = createClient();
              const { error } = await supabase
                .from('sub_events')
                .update({ open_to_all_staff: v })
                .eq('id', eventId);
              if (error) toast(error.message, 'error');
              else {
                setEvents((prev) =>
                  prev.map((ev) => (ev.id === eventId ? { ...ev, open_to_all_staff: v } : ev))
                );
                toast(v ? '已開放全部註冊組員' : '已改為逐一授權', 'success');
              }
            }}
          >
            開放給所有註冊組員（不限定名單）
          </Switch>
        </div>

        {!form?.open_to_all_staff && (
          <>
            {grants.length === 0 ? (
              <div className="empty">尚未授權任何組員</div>
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
                    {grants.map((g) => (
                      <tr key={g.id}>
                        <td>{g.app_users?.display_name}</td>
                        <td>{g.app_users?.account}</td>
                        <td style={{ textAlign: 'right' }}>
                          <Button size="sm" onClick={() => removeGrant(g.id)}>
                            取消授權
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <label className="field">
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
          </>
        )}
      </Modal>

      {/* 開場前 */}
      <Modal open={modal === 'start'} title="報到準備" onClose={() => setModal(null)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Button block onClick={copyLink}>
            複製報到連結
          </Button>
          <Button block onClick={printRoster} disabled={roster.length === 0}>
            列印紙本清單（{roster.length} 人）
          </Button>
          <Button block variant="primary" onClick={() => router.push(`/checkin/${eventId}`)}>
            進入報到畫面
          </Button>
          <Button block onClick={() => router.push('/records')}>
            查看報到紀錄
          </Button>
        </div>
      </Modal>
    </>
  );
}
