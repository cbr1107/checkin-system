'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FIELD_OPTIONS, guessField, buildRows, inspectRows } from '@/lib/roster';
import Button from '@/components/ui/Button';
import Busy from '@/components/ui/Busy';
import { useToast } from '@/components/ui/UiProvider';

export default function ImportWizard({ subEventId }) {
  const router = useRouter();
  const toast = useToast();

  const [step, setStep] = useState('idle');
  const [filename, setFilename] = useState('');
  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [result, setResult] = useState(null);
  const [busyLabel, setBusyLabel] = useState('');
  const [importing, setImporting] = useState(false);
  const [, startRefresh] = useTransition();

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setResult(null);
    setBusyLabel('讀取檔案…');

    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

      if (rows.length === 0) {
        toast('這個檔案的第一個工作表沒有資料', 'error');
        setBusyLabel('');
        return;
      }

      const detected = Object.keys(rows[0]);
      const guessed = {};
      let hasCode = false;
      for (const header of detected) {
        const field = guessField(header);
        if (field === 'code' && hasCode) guessed[header] = 'extra';
        else {
          guessed[header] = field;
          if (field === 'code') hasCode = true;
        }
      }

      setFilename(file.name);
      setHeaders(detected);
      setRawRows(rows);
      setMapping(guessed);
      setStep('mapping');
    } catch (err) {
      toast(`讀取檔案失敗：${err.message}`, 'error');
    }

    setBusyLabel('');
    event.target.value = '';
  }

  const prepared = step === 'mapping' ? inspectRows(buildRows(rawRows, mapping)) : null;
  const usedFields = Object.values(mapping);
  const missingRequired = !usedFields.includes('name') || !usedFields.includes('code');
  const hasQrColumn = usedFields.includes('qr_code');

  async function submitImport() {
    if (!prepared || prepared.valid.length === 0) return;
    setImporting(true);
    setBusyLabel(`匯入 ${prepared.valid.length} 筆…`);

    const res = await fetch(`/api/sub-events/${subEventId}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, mapping, rows: prepared.valid }),
    });
    const json = await res.json();

    setImporting(false);
    setBusyLabel('');

    if (!res.ok) {
      toast(json.error || '匯入失敗', 'error');
      return;
    }

    setResult(json);
    setStep('done');
    toast(`匯入完成：新增 ${json.created} 筆、更新 ${json.updated} 筆`, 'success');
    startRefresh(() => router.refresh());
  }

  function reset() {
    setStep('idle');
    setHeaders([]);
    setRawRows([]);
    setMapping({});
    setFilename('');
  }

  return (
    <div className="card">
      <Busy show={Boolean(busyLabel)} label={busyLabel} />
      <h3>匯入名單</h3>

      {step === 'idle' && (
        <>
          <label className="field" style={{ maxWidth: 380 }}>
            <span>選擇 Excel 或 CSV 檔（讀取第一個工作表）</span>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
          </label>
        </>
      )}

      {step === 'mapping' && prepared && (
        <>
          <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
            {filename} · {rawRows.length} 列
          </p>

          <div className="table-wrap" style={{ marginBottom: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>Excel 欄位</th>
                  <th>第一列內容</th>
                  <th>匯入為</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((header) => (
                  <tr key={header}>
                    <td>{header}</td>
                    <td style={{ color: 'var(--muted-foreground)' }}>
                      {String(rawRows[0][header] ?? '').slice(0, 30) || '—'}
                    </td>
                    <td>
                      <select
                        className="input-sm"
                        value={mapping[header]}
                        onChange={(e) =>
                          setMapping((prev) => ({ ...prev, [header]: e.target.value }))
                        }
                        style={{ maxWidth: 180 }}
                      >
                        {FIELD_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {missingRequired && (
            <div className="notice notice-error">姓名與編號都必須各對應到一個欄位。</div>
          )}

          {!hasQrColumn && !missingRequired && (
            <div className="notice notice-info">沒有對應 QR 欄位，將以編號作為 QR 內容。</div>
          )}

          {prepared.problems.length > 0 && (
            <div className="notice notice-error">
              有 {prepared.problems.length} 列需要注意：
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {prepared.problems.slice(0, 8).map((p, i) => (
                  <li key={i}>
                    第 {p.line} 列 — {p.reason}
                    {p.name ? `（${p.name}）` : ''}
                    {p.code ? `（${p.code}）` : ''}
                  </li>
                ))}
                {prepared.problems.length > 8 && (
                  <li>其餘 {prepared.problems.length - 8} 列略。</li>
                )}
              </ul>
            </div>
          )}


          <div style={{ display: 'flex', gap: 10 }}>
            <Button
              variant="primary"
              loading={importing}
              onClick={submitImport}
              disabled={missingRequired || prepared.valid.length === 0}
            >
              匯入 {prepared.valid.length} 筆
            </Button>
            <Button onClick={reset} disabled={importing}>
              取消
            </Button>
          </div>
        </>
      )}

      {step === 'done' && result && (
        <>
          <div className="notice notice-ok">
            匯入完成：新增名單 {result.created} 筆、更新 {result.updated} 筆，
            其中 {result.new_participants} 位是第一次進入系統的人員。
          </div>

          {result.conflicts?.length > 0 && (
            <div className="notice notice-error">
              有 {result.conflicts.length} 筆未匯入：
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {result.conflicts.slice(0, 8).map((c, i) => (
                  <li key={i}>
                    {c.code} {c.name ? `（${c.name}）` : ''} — {c.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button onClick={reset}>再匯入一個檔案</Button>
        </>
      )}
    </div>
  );
}
