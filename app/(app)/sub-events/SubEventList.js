'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Switch from '@/components/ui/Switch';
import { useToast } from '@/components/ui/UiProvider';

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
  const toast = useToast();

  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [requireCheckout, setRequireCheckout] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();

  async function createEvent(event) {
    event.preventDefault();
    setBusy(true);

    const supabase = createClient();
    const { error } = await supabase.from('sub_events').insert({
      name: name.trim(),
      location: location.trim() || null,
      starts_at: startsAt ? new Date(startsAt).toISOString() : null,
      require_checkout: requireCheckout,
    });

    setBusy(false);
    if (error) {
      toast(error.message, 'error');
      return;
    }

    toast(`已建立「${name.trim()}」`, 'success');
    setName('');
    setLocation('');
    setStartsAt('');
    setRequireCheckout(false);
    startRefresh(() => router.refresh());
  }

  return (
    <>
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

            <div style={{ paddingBottom: 9 }}>
              <Switch checked={requireCheckout} onChange={setRequireCheckout}>
                需要簽退
              </Switch>
            </div>

            <Button type="submit" variant="primary" loading={busy}>
              建立
            </Button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3>
          全部子活動（{initialEvents.length}）
          {refreshing && <Spinner size="sm" className="spinner-inline" />}
        </h3>

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
                  <th>已報到／名單</th>
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
                    <td>
                      {counts[ev.id]?.checkedIn ?? 0}／{counts[ev.id]?.total ?? 0} 人
                    </td>
                    <td>
                      {ev.require_checkout ? (
                        <span className="badge badge-info">需簽退</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {ev.is_active ? (
                        <span className="badge badge-success">進行中</span>
                      ) : (
                        <span className="badge">已封存</span>
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
