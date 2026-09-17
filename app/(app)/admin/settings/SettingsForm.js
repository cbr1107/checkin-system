'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Busy from '../../Busy';

const SIZES = [
  { value: 'xl', label: '特大' },
  { value: 'lg', label: '大' },
  { value: 'md', label: '中' },
  { value: 'sm', label: '小' },
];

const FIXED = ['name', 'code', 'team'];

export default function SettingsForm({ displayFields, offlineCheckin }) {
  const router = useRouter();
  const [fields, setFields] = useState(displayFields.fields || []);
  const [offline, setOffline] = useState(offlineCheckin.enabled !== false);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [busyLabel, setBusyLabel] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function patch(index, changes) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...changes } : f)));
  }

  function move(index, delta) {
    setFields((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function addField(e) {
    e.preventDefault();
    const key = newKey.trim();
    if (!key) return;
    if (fields.some((f) => f.key === key)) {
      setError('這個欄位已經在清單中');
      return;
    }
    setError('');
    setFields((prev) => [
      ...prev,
      { key, label: newLabel.trim() || key, enabled: true, size: 'md' },
    ]);
    setNewKey('');
    setNewLabel('');
  }

  function removeField(index) {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  async function save() {
    setBusyLabel('儲存設定…');
    setMessage('');
    setError('');

    const supabase = createClient();
    const results = await Promise.all([
      supabase
        .from('app_settings')
        .upsert({ key: 'display_fields', value: { fields }, updated_at: new Date().toISOString() }),
      supabase
        .from('app_settings')
        .upsert({
          key: 'offline_checkin',
          value: { enabled: offline },
          updated_at: new Date().toISOString(),
        }),
    ]);

    setBusyLabel('');
    const failed = results.find((r) => r.error);
    if (failed) {
      setError(failed.error.message);
      return;
    }

    setMessage('設定已儲存。報到中的裝置重新整理後生效。');
    router.refresh();
  }

  return (
    <>
      <Busy show={Boolean(busyLabel)} label={busyLabel} />

      {error && <div className="notice notice-error">{error}</div>}
      {message && <div className="notice notice-ok">{message}</div>}

      <div className="card">
        <h3>離線報到</h3>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="checkbox"
            checked={offline}
            onChange={(e) => setOffline(e.target.checked)}
            style={{ width: 16 }}
          />
          允許裝置在沒有網路時繼續報到，恢復連線後自動同步
        </label>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '10px 0 0' }}>
          關閉後，斷線時掃碼會直接顯示「離線報到未開放」，不會寫入本機佇列。
          需要每一筆報到都即時反映在資料庫、或不希望名單留在裝置上時可以關掉；
          代價是場地訊號一斷，現場就無法報到。
        </p>
      </div>

      <div className="card">
        <h3>報到畫面顯示欄位</h3>
        <p style={{ color: 'var(--muted)', marginTop: 0 }}>
          由上而下即為畫面順序。姓名、編號、組別是固定欄位，
          其他欄位請填匯入 Excel 時的欄位標題。
        </p>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>顯示</th>
                <th>欄位</th>
                <th>畫面標籤</th>
                <th>字級</th>
                <th>順序</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field, index) => (
                <tr key={field.key}>
                  <td>
                    <input
                      type="checkbox"
                      checked={field.enabled !== false}
                      onChange={(e) => patch(index, { enabled: e.target.checked })}
                      style={{ width: 16 }}
                    />
                  </td>
                  <td>{field.key}</td>
                  <td>
                    <input
                      value={field.label}
                      onChange={(e) => patch(index, { label: e.target.value })}
                      style={{ maxWidth: 160, padding: '4px 8px' }}
                    />
                  </td>
                  <td>
                    <select
                      value={field.size || 'md'}
                      onChange={(e) => patch(index, { size: e.target.value })}
                      style={{ maxWidth: 110, padding: '4px 8px' }}
                    >
                      {SIZES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn-quiet btn-sm" onClick={() => move(index, -1)}>
                      上移
                    </button>{' '}
                    <button className="btn-quiet btn-sm" onClick={() => move(index, 1)}>
                      下移
                    </button>{' '}
                    {!FIXED.includes(field.key) && (
                      <button className="btn-quiet btn-sm" onClick={() => removeField(index)}>
                        移除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form onSubmit={addField} className="row" style={{ marginTop: 16 }}>
          <label className="field">
            <span>新增欄位（Excel 標題）</span>
            <input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="例：房號"
            />
          </label>
          <label className="field">
            <span>畫面標籤（留空同上）</span>
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          </label>
          <button className="btn-quiet">加入</button>
        </form>
      </div>

      <div style={{ marginTop: 20 }}>
        <button className="btn-primary" onClick={save} disabled={Boolean(busyLabel)}>
          儲存設定
        </button>
      </div>
    </>
  );
}
