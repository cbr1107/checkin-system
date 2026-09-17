/** 名單欄位的正規化與匯入欄位定義（前後端共用） */

export const FIELD_OPTIONS = [
  { value: 'ignore', label: '不匯入' },
  { value: 'name', label: '姓名' },
  { value: 'code', label: '編號' },
  { value: 'qr_code', label: 'QR 碼內容' },
  { value: 'team', label: '組別' },
  { value: 'extra', label: '其他欄位（保留）' },
];

/** 編號正規化：去頭尾空白、轉大寫。掃碼與匯入都用同一套規則。 */
export function normalizeCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

/** QR 內容維持原樣，只去頭尾空白（條碼槍常帶換行） */
export function normalizeQr(value) {
  return String(value ?? '').trim();
}

export function cleanText(value) {
  return String(value ?? '').trim();
}

/** 依標題文字猜測欄位對應 */
export function guessField(header) {
  const h = cleanText(header).toLowerCase();
  if (!h) return 'ignore';
  if (/(qr|條碼|二維|barcode)/.test(h)) return 'qr_code';
  if (/(姓名|名字|name)/.test(h)) return 'name';
  if (/(編號|學號|代號|序號|id|code|no\.?$)/.test(h)) return 'code';
  if (/(組別|小組|分組|隊別|team|group)/.test(h)) return 'team';
  return 'extra';
}

/**
 * 依對應把原始列轉成標準列。
 * mapping: { 原始標題: 'name' | 'code' | ... }
 */
export function buildRows(rawRows, mapping) {
  return rawRows.map((raw, index) => {
    const row = { extra: {} };
    for (const [header, target] of Object.entries(mapping)) {
      const value = raw[header];
      if (target === 'ignore' || value === undefined || value === null) continue;
      if (target === 'extra') {
        const text = cleanText(value);
        if (text) row.extra[cleanText(header)] = text;
      } else {
        row[target] = cleanText(value);
      }
    }
    row.code = normalizeCode(row.code);
    row.qr_code = normalizeQr(row.qr_code) || row.code; // 未對應 QR 欄位時預設用編號
    row.name = cleanText(row.name);
    row.team = cleanText(row.team) || null;
    row._line = index + 2; // Excel 上的列號（含標題列）
    return row;
  });
}

/** 匯入前檢查，回傳 { valid, problems } */
export function inspectRows(rows) {
  const problems = [];
  const seen = new Map();
  const valid = [];

  for (const row of rows) {
    if (!row.code && !row.name) continue; // 整列空白，略過
    if (!row.code) {
      problems.push({ line: row._line, reason: '缺少編號', name: row.name });
      continue;
    }
    if (!row.name) {
      problems.push({ line: row._line, reason: '缺少姓名', code: row.code });
      continue;
    }
    if (seen.has(row.code)) {
      problems.push({
        line: row._line,
        reason: `編號與第 ${seen.get(row.code)} 列重複，只會保留最後一筆`,
        code: row.code,
      });
    }
    seen.set(row.code, row._line);
    valid.push(row);
  }

  // 同一編號取最後一筆
  const byCode = new Map();
  for (const row of valid) byCode.set(row.code, row);

  return { valid: [...byCode.values()], problems };
}
