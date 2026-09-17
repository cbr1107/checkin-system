'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { atLeast } from '@/lib/constants';
import { formatDuration } from '@/lib/attendance';
import Busy from '../Busy';

const LOG_SELECT =
  'id, type, method, occurred_at, revoked_at, duplicate_of, operator:app_users!attendance_logs_operator_id_fkey(display_name), registrations!inner(id, team, sub_event_id, participants(code, name))';

function timeLabel(value) {
  return new Date(value).toLocaleString('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function RecordsView({ profile, events }) {
  const canSeeAll = atLeast(profile.role, 'staff');
  const canRevoke = atLeast(profile.role, 'lead');

  const [eventId, setEventId] = useState(events[0]?.id || '');
  const [roster, setRoster] = useState([]);
  const [logs, setLogs] = useState([]);
  const [typeFilter, setTypeFilter] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState('');

  const event = events.find((e) => e.id === eventId) || null;

  const load = useCallback(
    async (showSpinner = true) => {
      if (!eventId) return;
      if (showSpinner) setLoading(true);
      setError('');

      const supabase = createClient();
      const [rosterRes, logRes] = await Promise.all([
        supabase
          .from('registrations')
          .select('id, team, checked_in_at, checked_out_at, participants(code, name)')
          .eq('sub_event_id', eventId)
          .limit(2000),
        supabase
          .from('attendance_logs')
          .select(LOG_SELECT)
          .eq('registrations.sub_event_id', eventId)
          .order('occurred_at', { ascending: false })
          .limit(1000),
      ]);

      if (rosterRes.error || logRes.error) {
        setError((rosterRes.error || logRes.error).message);
      } else {
        setRoster(rosterRes.data || []);
        setLogs(logRes.data || []);
      }

      setLoading(false);
    },
    [eventId]
  );

  useEffect(() => {
    load();
  }, [load]);

  // 現場報到時自動更新
  useEffect(() => {
    if (!eventId || !canSeeAll) return undefined;
    const supabase = createClient();
    const channel = supabase
      .channel(`records-${eventId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance_logs' },
        () => load(false)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, canSeeAll, load]);

  const stats = useMemo(() => {
    const total = roster.length;
    const checkedIn = roster.filter((r) => r.checked_in_at).length;
    const checkedOut = roster.filter((r) => r.checked_out_at).length;

    const teams = new Map();
    for (const row of roster) {
      const key = row.team || '未分組';
      const item = teams.get(key) || { total: 0, checkedIn: 0 };
      item.total += 1;
      if (row.checked_in_at) item.checkedIn += 1;
      teams.set(key, item);
    }

    return {
      total,
      checkedIn,
      checkedOut,
      present: checkedIn - checkedOut,
      rate: total ? Math.round((checkedIn / total) * 100) : 0,
      teams: [...teams.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant')),
    };
  }, [roster]);

  const visibleLogs = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return logs.filter((log) => {
      if (typeFilter !== 'all' && log.type !== typeFilter) return false;
      if (!k) return true;
      const p = log.registrations?.participants;
      return (
        p?.name?.toLowerCase().includes(k) ||
        p?.code?.toLowerCase().includes(k) ||
        (log.registrations?.team || '').toLowerCase().includes(k) ||
        (log.operator?.display_name || '').toLowerCase().includes(k)
      );
    });
  }, [logs, typeFilter, keyword]);

  async function revoke(log) {
    const reason = window.prompt(
      `撤銷 ${log.registrations?.participants?.name} 的${log.type === 'in' ? '報到' : '簽退'}紀錄？可填原因：`,
      ''
    );
    if (reason === null) return;

    setBusyLabel('撤銷中…');
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc('revoke_attendance', {
      p_log_id: log.id,
      p_reason: reason || null,
    });
    setBusyLabel('');

    if (rpcError || data?.status !== 'ok') {
      setError(rpcError?.message || '撤銷失敗');
      return;
    }
    load(false);
  }

  async function exportXlsx() {
    setBusyLabel('產生 Excel…');
    try {
      const XLSX = await import('xlsx');

      const lastLog = new Map();
      for (const log of logs) {
        if (log.revoked_at || log.duplicate_of) continue;
        lastLog.set(`${log.registrations?.id}-${log.type}`, log);
      }

      const rows = roster.map((r) => {
        const inLog = lastLog.get(`${r.id}-in`);
        const outLog = lastLog.get(`${r.id}-out`);
        return {
          編號: r.participants?.code || '',
          姓名: r.participants?.name || '',
          組別: r.team || '',
          報到時間: r.checked_in_at ? timeLabel(r.checked_in_at) : '',
          報到操作者: inLog?.operator?.display_name || '',
          報到方式: inLog ? (inLog.method === 'manual' ? '手動' : '掃碼') : '',
          簽退時間: r.checked_out_at ? timeLabel(r.checked_out_at) : '',
          簽退操作者: outLog?.operator?.display_name || '',
          停留時間:
            r.checked_in_at && r.checked_out_at
              ? formatDuration(r.checked_in_at, r.checked_out_at)
              : '',
          狀態: r.checked_out_at ? '已簽退' : r.checked_in_at ? '已報到' : '未報到',
        };
      });

      const sheet = XLSX.utils.json_to_sheet(rows);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, '報到結果');
      XLSX.writeFile(book, `${event?.name || '報到結果'}.xlsx`);
    } catch (err) {
      setError(`匯出失敗：${err.message}`);
    }
    setBusyLabel('');
  }

  if (events.length === 0) {
    return (
      <div className="card">
        <div className="empty">目前沒有子活動。</div>
      </div>
    );
  }

  return (
    <>
      <Busy show={Boolean(busyLabel)} label={busyLabel} />

      {error && <div className="notice notice-error">{error}</div>}

      <div className="card">
        <div className="row">
          <label className="field">
            <span>子活動</span>
            <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                  {ev.is_active ? '' : '（已封存）'}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>類型</span>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">全部</option>
              <option value="in">報到</option>
              <option value="out">簽退</option>
            </select>
          </label>

          <label className="field">
            <span>搜尋姓名、編號、組別或操作者</span>
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          </label>

          {canSeeAll && (
            <button className="btn-quiet" onClick={exportXlsx} disabled={loading}>
              匯出 Excel
            </button>
          )}
        </div>
      </div>

      {canSeeAll && (
        <div className="card">
          <h3>
            進度
            {loading && <span className="spinner inline" aria-label="更新中" />}
          </h3>

          <div className="stat-grid">
            <div className="stat">
              <span className="stat-value">
                {stats.checkedIn}
                <em>／{stats.total}</em>
              </span>
              <span className="stat-label">已報到（{stats.rate}%）</span>
            </div>

            {event?.require_checkout && (
              <>
                <div className="stat">
                  <span className="stat-value">{stats.present}</span>
                  <span className="stat-label">目前在場</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{stats.checkedOut}</span>
                  <span className="stat-label">已簽退</span>
                </div>
              </>
            )}

            <div className="stat">
              <span className="stat-value">{stats.total - stats.checkedIn}</span>
              <span className="stat-label">尚未報到</span>
            </div>
          </div>

          <div className="team-bars">
            {stats.teams.map(([team, item]) => (
              <div key={team} className="team-bar">
                <span className="team-name">{team}</span>
                <span className="bar">
                  <span
                    className="bar-fill"
                    style={{ width: `${item.total ? (item.checkedIn / item.total) * 100 : 0}%` }}
                  />
                </span>
                <span className="team-count">
                  {item.checkedIn}／{item.total}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h3>
          逐筆紀錄（{visibleLogs.length}）
          {loading && <span className="spinner inline" aria-label="載入中" />}
        </h3>

        {visibleLogs.length === 0 ? (
          <div className="empty">{loading ? '載入中…' : '沒有符合條件的紀錄。'}</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>時間</th>
                  <th>姓名</th>
                  <th>編號</th>
                  <th>組別</th>
                  <th>動作</th>
                  <th>方式</th>
                  <th>操作者</th>
                  {canRevoke && <th />}
                </tr>
              </thead>
              <tbody>
                {visibleLogs.map((log) => (
                  <tr key={log.id} className={log.revoked_at || log.duplicate_of ? 'muted-row' : ''}>
                    <td>{timeLabel(log.occurred_at)}</td>
                    <td>{log.registrations?.participants?.name}</td>
                    <td>{log.registrations?.participants?.code}</td>
                    <td>{log.registrations?.team || '—'}</td>
                    <td>
                      {log.type === 'in' ? '報到' : '簽退'}
                      {log.revoked_at && '（已撤銷）'}
                      {log.duplicate_of && '（重複）'}
                    </td>
                    <td>{log.method === 'manual' ? '手動' : '掃碼'}</td>
                    <td>{log.operator?.display_name || '—'}</td>
                    {canRevoke && (
                      <td style={{ textAlign: 'right' }}>
                        {!log.revoked_at && !log.duplicate_of && (
                          <button className="btn-quiet btn-sm" onClick={() => revoke(log)}>
                            撤銷
                          </button>
                        )}
                      </td>
                    )}
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
