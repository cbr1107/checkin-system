'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  SCAN_COOLDOWN_MS,
  SCANNER_GAP_MS,
  describeResult,
  makeEventId,
  resolveDisplayFields,
  fieldValue,
  beep,
  buzz,
  formatTime,
} from '@/lib/attendance';
import {
  saveRoster,
  loadRoster,
  enqueue,
  dequeue,
  listQueue,
  bumpAttempt,
} from '@/lib/offline';
import Busy from '@/components/ui/Busy';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

const ROSTER_SELECT =
  'id, team, extra, checked_in_at, checked_out_at, participants(id, code, name, qr_code, extra)';

function toPayload(row) {
  return {
    registration_id: row.id,
    code: row.participants?.code,
    name: row.participants?.name,
    team: row.team,
    extra: { ...(row.participants?.extra || {}), ...(row.extra || {}) },
    checked_in_at: row.checked_in_at,
    checked_out_at: row.checked_out_at,
  };
}

export default function CheckinConsole({
  profile,
  event,
  globalFields,
  offlineEnabled = true,
  roster,
}) {
  const [mode, setMode] = useState('in');
  const [result, setResult] = useState(null);
  const [pending, setPending] = useState(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [rows, setRows] = useState(roster);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [cachedAt, setCachedAt] = useState(null);

  const inputRef = useRef(null);
  const scannerRef = useRef(null);
  const rowsRef = useRef(roster);
  const lastScan = useRef({ value: '', at: 0 });
  const typing = useRef({ last: 0, gaps: [] });

  const fields = useMemo(
    () => resolveDisplayFields(event.display_fields, globalFields),
    [event.display_fields, globalFields]
  );

  const setRowsBoth = useCallback(
    (updater) => {
      setRows((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        rowsRef.current = next;
        saveRoster(event.id, event, next);
        return next;
      });
    },
    [event]
  );

  const stats = useMemo(() => {
    const total = rows.length;
    const inCount = rows.filter((r) => r.checked_in_at).length;
    const outCount = rows.filter((r) => r.checked_out_at).length;
    return { total, inCount, outCount, present: inCount - outCount };
  }, [rows]);

  /* ---------------- 啟動：合併快取 ---------------- */
  useEffect(() => {
    let alive = true;

    (async () => {
      const cached = await loadRoster(event.id);
      if (!alive) return;

      if (cached?.rows?.length) {
        setCachedAt(cached.cached_at);
        const localById = new Map(cached.rows.map((r) => [r.id, r]));
        const base = roster.length ? roster : cached.rows;
        // 伺服器名單為主，但保留本機尚未同步的報到狀態
        const merged = base.map((row) => {
          const local = localById.get(row.id);
          if (!local) return row;
          return {
            ...row,
            checked_in_at: row.checked_in_at || local.checked_in_at,
            checked_out_at: row.checked_out_at || local.checked_out_at,
          };
        });
        setRowsBoth(merged);
      } else {
        setRowsBoth(roster);
      }

      setQueued((await listQueue(event.id)).length);
    })();

    return () => {
      alive = false;
    };
  }, [event.id, roster, setRowsBoth]);

  /* ---------------- 連線狀態 ---------------- */
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  /* ---------------- 同步佇列 ---------------- */
  const refreshRoster = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('registrations')
      .select(ROSTER_SELECT)
      .eq('sub_event_id', event.id)
      .limit(2000);
    if (!error && data) setRowsBoth(data);
  }, [event.id, setRowsBoth]);

  const sync = useCallback(async () => {
    if (syncing || !navigator.onLine) return;

    const items = await listQueue(event.id);
    if (items.length === 0) {
      setQueued(0);
      return;
    }

    setSyncing(true);
    const supabase = createClient();

    for (const item of items) {
      // 連續失敗多次的項目先跳過，避免卡住整條佇列
      if ((item.attempts || 0) >= 5) continue;

      const { data, error } = await supabase.rpc('perform_attendance', {
        p_sub_event_id: item.sub_event_id,
        p_qr: item.qr,
        p_type: item.type,
        p_method: item.method,
        p_client_event_id: item.id,
        p_device_label: item.device_label || null,
        p_force: true,
        p_occurred_at: item.occurred_at,
      });

      if (error) {
        await bumpAttempt(item);
        break; // 連線又斷了，保留其餘項目下次再送
      }

      await dequeue(item.id);
      setQueued((n) => Math.max(0, n - 1));

      if (!['ok', 'already_in', 'already_out'].includes(data?.status)) {
        console.warn('離線紀錄未被接受', item, data);
      }
    }

    setQueued((await listQueue(event.id)).length);
    setSyncing(false);
    await refreshRoster();
  }, [event.id, syncing, refreshRoster]);

  useEffect(() => {
    if (online) sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  useEffect(() => {
    if (queued === 0) return undefined;
    const timer = setInterval(() => {
      if (navigator.onLine) sync();
    }, 20000);
    return () => clearInterval(timer);
  }, [queued, sync]);

  /* ---------------- 本機判斷 ---------------- */
  const findLocal = useCallback((key) => {
    const value = String(key || '').trim();
    const upper = value.toUpperCase();
    return (
      rowsRef.current.find(
        (r) => r.participants?.qr_code === value || r.participants?.code === upper
      ) || null
    );
  }, []);

  const evaluateLocal = useCallback(
    (row, type, force) => {
      const data = toPayload(row);

      if (type === 'in') {
        if (row.checked_in_at) {
          return {
            status: 'already_in',
            data: { ...data, previous_at: row.checked_in_at },
          };
        }
        return { status: 'ok', data };
      }

      if (!event.require_checkout) return { status: 'checkout_off', data };
      if (!row.checked_in_at) return { status: 'not_checked_in', data };
      if (row.checked_out_at) return { status: 'already_out', data };

      const minutes = (Date.now() - new Date(row.checked_in_at)) / 60000;
      if (!force && event.min_stay_minutes > 0 && minutes < event.min_stay_minutes) {
        return {
          status: 'too_soon',
          data: {
            ...data,
            minutes_elapsed: Math.round(minutes * 10) / 10,
            min_stay_minutes: event.min_stay_minutes,
          },
        };
      }

      return { status: 'ok', data };
    },
    [event.require_checkout, event.min_stay_minutes]
  );

  const show = useCallback((status, type, data, offline = false) => {
    const view = describeResult(status, type, data);
    setResult({ status, type, data, view, offline });
    beep(view.tone);
    buzz(view.tone);
  }, []);

  /* ---------------- 送出 ---------------- */
  const submitOffline = useCallback(
    async (key, method, force, clientEventId) => {
      if (!offlineEnabled) {
        show('offline_disabled', mode, {});
        return;
      }

      const row = findLocal(key);
      if (!row) {
        show('unknown_qr', mode, { scanned: key }, true);
        return;
      }

      const outcome = evaluateLocal(row, mode, force);

      if (outcome.status === 'too_soon') {
        setPending({ value: key, method, data: outcome.data });
        beep('warn');
        buzz('warn');
        return;
      }

      if (outcome.status !== 'ok') {
        show(outcome.status, mode, outcome.data, true);
        return;
      }

      const occurredAt = new Date().toISOString();

      await enqueue({
        id: clientEventId,
        sub_event_id: event.id,
        qr: row.participants.qr_code,
        type: mode,
        method,
        occurred_at: occurredAt,
        attempts: 0,
      });

      setRowsBoth((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? {
                ...r,
                ...(mode === 'in'
                  ? { checked_in_at: occurredAt }
                  : { checked_out_at: occurredAt }),
              }
            : r
        )
      );

      setQueued((await listQueue(event.id)).length);
      show(
        'ok',
        mode,
        {
          ...outcome.data,
          ...(mode === 'in'
            ? { checked_in_at: occurredAt }
            : { checked_out_at: occurredAt }),
        },
        true
      );
    },
    [event.id, findLocal, evaluateLocal, mode, show, setRowsBoth, offlineEnabled]
  );

  const submit = useCallback(
    async (value, method, force = false) => {
      const key = String(value || '').trim();
      if (!key) return;

      const now = Date.now();
      if (
        !force &&
        method === 'scan' &&
        key === lastScan.current.value &&
        now - lastScan.current.at < SCAN_COOLDOWN_MS
      ) {
        return;
      }
      lastScan.current = { value: key, at: now };

      setBusy(true);
      setPending(null);
      const clientEventId = makeEventId();

      if (!navigator.onLine) {
        await submitOffline(key, method, force, clientEventId);
        setBusy(false);
        return;
      }

      const supabase = createClient();
      const { data, error } = await supabase.rpc('perform_attendance', {
        p_sub_event_id: event.id,
        p_qr: key,
        p_type: mode,
        p_method: method,
        p_client_event_id: clientEventId,
        p_device_label: null,
        p_force: force,
        p_occurred_at: new Date().toISOString(),
      });

      if (error) {
        // 連線中斷：改走離線流程，掃碼不中斷
        await submitOffline(key, method, force, clientEventId);
        setBusy(false);
        return;
      }

      setBusy(false);

      if (data.status === 'too_soon') {
        setPending({ value: key, method, data });
        beep('warn');
        buzz('warn');
        return;
      }

      if (data.status === 'ok') {
        setRowsBoth((prev) =>
          prev.map((r) =>
            r.id === data.registration_id
              ? {
                  ...r,
                  checked_in_at: data.checked_in_at,
                  checked_out_at: data.checked_out_at,
                }
              : r
          )
        );
      }

      show(data.status, mode, data);
    },
    [event.id, mode, show, submitOffline, setRowsBoth]
  );

  /* ---------------- 條碼槍 ---------------- */
  useEffect(() => {
    const focus = () => {
      if (!pending && document.activeElement?.dataset?.manual !== 'true') {
        inputRef.current?.focus();
      }
    };
    focus();
    const timer = setInterval(focus, 1500);
    return () => clearInterval(timer);
  }, [pending]);

  function handleKeyDown(e) {
    const now = Date.now();
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = inputRef.current.value;
      const gaps = typing.current.gaps;
      const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 999;
      typing.current = { last: 0, gaps: [] };
      inputRef.current.value = '';
      submit(value, avg < SCANNER_GAP_MS ? 'scan' : 'manual');
      return;
    }
    if (e.key.length === 1) {
      if (typing.current.last) {
        typing.current.gaps.push(now - typing.current.last);
        if (typing.current.gaps.length > 20) typing.current.gaps.shift();
      }
      typing.current.last = now;
    }
  }

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

  async function toggleCamera() {
    if (cameraOn) {
      await stopCamera();
      setCameraOn(false);
      return;
    }

    setCameraError('');
    setCameraStarting(true);

    // 容器必須先顯示出來：html5-qrcode 會量它的尺寸，
    // 對著 display:none 的容器啟動會拿到 0×0，相機開了卻看不到畫面。
    setCameraOn(true);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const scanner = new Html5Qrcode('qr-reader', { verbose: false });

      // 優先用後鏡頭；抓不到裝置清單時退回 facingMode
      let cameraConfig = { facingMode: 'environment' };
      try {
        const cameras = await Html5Qrcode.getCameras();
        if (cameras?.length) {
          const back = cameras.find((c) => /back|rear|environment|後/i.test(c.label));
          cameraConfig = { deviceId: { exact: (back || cameras[cameras.length - 1]).id } };
        }
      } catch {
        // 沒有列舉權限就用 facingMode
      }

      await scanner.start(
        cameraConfig,
        {
          fps: 10,
          qrbox: (width, height) => {
            const edge = Math.floor(Math.min(width, height) * 0.75);
            return { width: edge, height: edge };
          },
          aspectRatio: 1.0,
        },
        (text) => submit(text, 'scan'),
        () => {}
      );
      scannerRef.current = scanner;
    } catch (err) {
      setCameraOn(false);
      setCameraError(
        err?.message?.includes('Permission')
          ? '瀏覽器沒有相機權限。請在網址列的權限設定中允許相機後再試。'
          : `無法啟動相機：${err?.message || '未知錯誤'}`
      );
    }
    setCameraStarting(false);
  }

  /* ---------------- 手動搜尋 ---------------- */
  const matches = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return [];
    return rows
      .filter(
        (r) =>
          r.participants?.name?.toLowerCase().includes(k) ||
          r.participants?.code?.toLowerCase().includes(k) ||
          (r.team || '').toLowerCase().includes(k)
      )
      .slice(0, 12);
  }, [rows, keyword]);

  const view = result?.view;

  return (
    <main className="checkin-shell">
      <Busy show={syncing} label="同步離線紀錄…" />

      <div className="checkin-bar">
        <div>
          <strong>{event.name}</strong>
          <span className="checkin-stats">
            已報到 {stats.inCount}／{stats.total}
            {event.require_checkout && ` · 在場 ${stats.present}`}
          </span>
        </div>

        {event.require_checkout ? (
          <div className="mode-switch" role="group" aria-label="報到模式">
            <button className={mode === 'in' ? 'active in' : ''} onClick={() => setMode('in')}>
              報到模式
            </button>
            <button className={mode === 'out' ? 'active out' : ''} onClick={() => setMode('out')}>
              簽退模式
            </button>
          </div>
        ) : (
          <span className="mode-static">報到模式</span>
        )}

        <Link href="/checkin" className="btn btn-secondary btn-sm">
          換活動
        </Link>
      </div>

      <div className={`sync-bar ${online ? '' : 'offline'}`}>
        <span className="sync-dot" aria-hidden="true" />
        <span>
          {online ? '已連線' : offlineEnabled ? '離線作業中' : '離線（未開放離線報到）'}
          {queued > 0 && ` · 待同步 ${queued} 筆`}
          {syncing && ' · 同步中…'}
        </span>

        {queued > 0 && online && (
          <Button size="sm" loading={syncing} onClick={sync}>
            立即同步
          </Button>
        )}

        {!online && cachedAt && (
          <span className="sync-note">
            名單快取於 {new Date(cachedAt).toLocaleString('zh-TW')}
          </span>
        )}
      </div>

      <div className="checkin-body">
        <section className="scan-pane">
          <input
            ref={inputRef}
            className="scan-input"
            placeholder="掃描條碼，或直接輸入編號後按 Enter"
            onKeyDown={handleKeyDown}
            autoComplete="off"
            disabled={busy || Boolean(pending)}
          />

          <div className="camera-box">
            <div id="qr-reader" className={cameraOn ? '' : 'hidden'} />
            {!cameraOn && (
              <div className="camera-placeholder">尚未開啟相機</div>
            )}
          </div>

          {cameraError && <div className="notice notice-error">{cameraError}</div>}

          <Button block loading={cameraStarting} onClick={toggleCamera}>
            {cameraOn ? '關閉相機' : '開啟相機掃碼'}
          </Button>
        </section>

        <section className={`result-pane tone-${view?.tone || 'idle'}`}>
          {busy && !pending ? (
            <div className="result-inner idle">
              <Spinner size="lg" />
              <p style={{ marginTop: 14 }}>處理中…</p>
            </div>
          ) : pending ? (
            <div className="result-inner">
              <h2>{describeResult('too_soon', 'out', pending.data).title}</h2>
              <p className="result-detail">
                {pending.data.name}（{pending.data.code}）
                {describeResult('too_soon', 'out', pending.data).detail}
              </p>
              <div className="result-actions">
                <Button
                  variant="primary"
                  loading={busy}
                  onClick={() => submit(pending.value, pending.method, true)}
                >
                  仍要簽退
                </Button>
                <Button variant="secondary" onClick={() => setPending(null)}>
                  取消
                </Button>
              </div>
            </div>
          ) : view ? (
            <div className="result-inner">
              <h2>{view.title}</h2>

              {result.data?.name && (
                <dl className="result-fields">
                  {fields.map((field) => {
                    const value = fieldValue(field, result.data);
                    if (!value) return null;
                    return (
                      <div key={field.key} className={`f-${field.size || 'md'}`}>
                        <dt>{field.label}</dt>
                        <dd>{value}</dd>
                      </div>
                    );
                  })}
                </dl>
              )}

              {view.detail && <p className="result-detail">{view.detail}</p>}

              {result.status === 'ok' && (
                <p className="result-time">
                  {formatTime(new Date())}
                  {result.offline && ' · 離線記錄，稍後同步'}
                </p>
              )}
            </div>
          ) : (
            <div className="result-inner idle">
              <p>等待掃碼</p>
            </div>
          )}
        </section>
      </div>

      <section className="manual-pane">
        <label className="field">
          <span>找不到條碼時，用姓名或編號搜尋</span>
          <input
            data-manual="true"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="輸入姓名、編號或組別"
          />
        </label>

        {matches.length > 0 && (
          <ul className="manual-results">
            {matches.map((row) => {
              const done = mode === 'in' ? row.checked_in_at : row.checked_out_at;
              return (
                <li key={row.id}>
                  <span>
                    {row.participants?.name}
                    <em>
                      {row.participants?.code}
                      {row.team ? ` · ${row.team}` : ''}
                    </em>
                  </span>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setKeyword('');
                      submit(row.participants.qr_code, 'manual', true);
                    }}
                  >
                    {done ? '已完成' : mode === 'in' ? '手動報到' : '手動簽退'}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
