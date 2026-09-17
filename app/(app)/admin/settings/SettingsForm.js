'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';
import Switch from '@/components/ui/Switch';
import { useToast } from '@/components/ui/UiProvider';

const SIZES = [
  { value: 'xl', label: '特大' },
  { value: 'lg', label: '大' },
  { value: 'md', label: '中' },
  { value: 'sm', label: '小' },
];

const FIXED = ['name', 'code', 'team'];

export default function SettingsForm({ displayFields, offlineCheckin }) {
  const router = useRouter();
  const toast = useToast();

  const [fields, setFields] = useState(displayFields.fields || []);
  const [offline, setOffline] = useState(offlineCheckin.enabled !== false);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [, startRefresh] = useTransition();

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
      toast('這個欄位已經在清單中', 'error');
      return;
    }
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
    setSaving(true);

    const supabase = createClient();
    const results = await Promise.all([
      supabase.from('app_settings').upsert({
        key: 'display_fields',
        value: { fields },
        updated_at: new Date().toISOString(),
      }),
      supabase.from('app_settings').upsert({
        key: 'offline_checkin',
        value: { enabled: offline },
        updated_at: new Date().toISOString(),
      }),
    ]);

    setSaving(false);
    const failed = results.find((r) => r.error);
    if (failed) {
      toast(failed.error.message, 'error');
      return;
    }

    toast('設定已儲存。報到中的裝置重新整理後生效。', 'success', 6000);
    startRefresh(() => router.refresh());
  }

  return (
    <>
      <div className="card">
        <h3>離線報到</h3>
        <Switch checked={offline} onChange={setOffline}>
          允許裝置在沒有網路時繼續報到，恢復連線後自動同步
        </Switch>
      </div>

      <div className="card">
        <h3>報到畫面顯示欄位</h3>

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
                    />
                  </td>
                  <td>{field.key}</td>
                  <td>
                    <input
                      className="input-sm"
                      value={field.label}
                      onChange={(e) => patch(index, { label: e.target.value })}
                      style={{ maxWidth: 160 }}
                    />
                  </td>
                  <td>
                    <select
                      className="input-sm"
                      value={field.size || 'md'}
                      onChange={(e) => patch(index, { size: e.target.value })}
                      style={{ maxWidth: 110 }}
                    >
                      {SIZES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      <Button size="sm" onClick={() => move(index, -1)}>
                        上移
                      </Button>
                      <Button size="sm" onClick={() => move(index, 1)}>
                        下移
                      </Button>
                      {!FIXED.includes(field.key) && (
                        <Button size="sm" variant="ghost" onClick={() => removeField(index)}>
                          移除
                        </Button>
                      )}
                    </span>
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
          <Button type="submit">加入</Button>
        </form>
      </div>

      <div style={{ marginTop: 20 }}>
        <Button variant="primary" loading={saving} onClick={save}>
          儲存設定
        </Button>
      </div>
    </>
  );
}
