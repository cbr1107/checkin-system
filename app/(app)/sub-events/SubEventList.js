'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

function formatRange(start, end) {
  if (!start) return '未設定時間';
  const fmt = (value) =>
    new Date(value).toLocaleString('zh-TW', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  return end ? `${fmt(start)} – ${fmt(end)}` : fmt(start);
}

export default function SubEventList({ initialEvents, counts }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [requireCheckout, setRequireCheckout] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function createEvent(event) {
    event.preventDefault();
    setError('');
    setBusy(true);

    const supabase = createClient();
    const { error: insertError } = await supabase.from('sub_events').insert({
      name: name.trim(),
      location: location.trim() || null,
      starts_at: startsAt ? new Date(startsAt).toISOString() : null,
      require_checkout: requireCheckout,
    });

    setBusy(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }

    setName('');
    setLocation('');
    setStartsAt('');
    setRequireCheckout(false);
    router.refresh();
  }

  return (
    <>
      {error && <div className="notice notice-error">{error}</div>}

      <div className="card">
        <h3>新增子活動</h3>
        <form onSubmit={createEvent}>
          <div className="row">
            <label className="field">
              <span>名稱</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：宿營"
                required
              />
            </label>
            <label className="field">
              <span>地點</span>
              <input value={location} onChange={(e) => setLocation(e.target.value)} />
            </label>
            <label className="field">
              <span>開始時間</span>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </label>
            <label
              className="field"
              style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <input
                type="checkbox"
                checked={requireCheckout}
                onChange={(e) => setRequireCheckout(e.target.checked)}
                style={{ width: 16 }}
              />
              <span style={{ margin: 0 }}>需要簽退</span>
            </label>
            <button className="btn-primary" disabled={busy}>
              {busy ? '建立中…' : '建立'}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3>全部子活動（{initialEvents.length}）</h3>
        {initialEvents.length === 0 ? (
          <div className="empty">還沒有子活動。用上面的表單建立第一個。</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>名稱</th>
                  <th>時間</th>
                  <th>地點</th>
                  <th>名單</th>
                  <th>簽退</th>
                  <th>狀態</th>
                </tr>
              </thead>
              <tbody>
                {initialEvents.map((ev) => (
                  <tr key={ev.id}>
                    <td>
                      <Link href={`/sub-events/${ev.id}`}>{ev.name}</Link>
                    </td>
                    <td>{formatRange(ev.starts_at, ev.ends_at)}</td>
                    <td>{ev.location || '—'}</td>
                    <td>{counts[ev.id] || 0} 人</td>
                    <td>{ev.require_checkout ? '需簽退' : '—'}</td>
                    <td>{ev.is_active ? '進行中' : '已封存'}</td>
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
