import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeCode, normalizeQr, cleanText } from '@/lib/roster';

const CHUNK = 400;

function chunked(list) {
  const out = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

export async function POST(request, { params }) {
  const subEventId = params.id;
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '尚未登入' }, { status: 401 });

  const { data: allowed } = await supabase.rpc('can_edit_roster', {
    target: subEventId,
  });
  if (!allowed) {
    return NextResponse.json({ error: '你沒有編輯這個子活動名單的權限' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const filename = cleanText(body.filename) || null;
  const mapping = body.mapping || {};
  const incoming = Array.isArray(body.rows) ? body.rows : [];

  if (incoming.length === 0) {
    return NextResponse.json({ error: '沒有可匯入的資料' }, { status: 400 });
  }
  if (incoming.length > 5000) {
    return NextResponse.json({ error: '單次匯入上限 5000 筆' }, { status: 400 });
  }

  // 伺服器端重新正規化並去重，不信任前端
  const byCode = new Map();
  for (const raw of incoming) {
    const code = normalizeCode(raw.code);
    const name = cleanText(raw.name);
    if (!code || !name) continue;
    byCode.set(code, {
      code,
      name,
      qr_code: normalizeQr(raw.qr_code) || code,
      team: cleanText(raw.team) || null,
      extra: raw.extra && typeof raw.extra === 'object' ? raw.extra : {},
    });
  }
  const rows = [...byCode.values()];
  if (rows.length === 0) {
    return NextResponse.json({ error: '沒有同時具備編號與姓名的資料列' }, { status: 400 });
  }

  const admin = createAdminClient();

  // 1. 既有人員
  const existing = new Map();
  for (const codes of chunked(rows.map((r) => r.code))) {
    const { data, error } = await admin
      .from('participants')
      .select('id, code, name, qr_code')
      .in('code', codes);
    if (error) {
      return NextResponse.json({ error: `讀取人員資料失敗：${error.message}` }, { status: 500 });
    }
    for (const p of data || []) existing.set(p.code, p);
  }

  // 2. QR 衝突檢查：同一個 QR 已被別的編號使用
  const qrList = rows.map((r) => r.qr_code);
  const qrOwners = new Map();
  for (const qrs of chunked(qrList)) {
    const { data } = await admin
      .from('participants')
      .select('id, code, qr_code')
      .in('qr_code', qrs);
    for (const p of data || []) qrOwners.set(p.qr_code, p);
  }

  const conflicts = [];
  const toInsert = [];
  const toUpdate = [];

  for (const row of rows) {
    const owner = qrOwners.get(row.qr_code);
    if (owner && owner.code !== row.code) {
      conflicts.push({
        code: row.code,
        name: row.name,
        reason: `QR 內容已被編號 ${owner.code} 使用`,
      });
      continue;
    }

    const found = existing.get(row.code);
    if (!found) {
      toInsert.push({
        code: row.code,
        name: row.name,
        qr_code: row.qr_code,
        extra: row.extra,
      });
    } else if (found.name !== row.name || found.qr_code !== row.qr_code) {
      toUpdate.push({ id: found.id, name: row.name, qr_code: row.qr_code });
    }
  }

  // 3. 新增人員
  const created = new Map();
  for (const batch of chunked(toInsert)) {
    const { data, error } = await admin
      .from('participants')
      .insert(batch)
      .select('id, code');
    if (error) {
      return NextResponse.json({ error: `新增人員失敗：${error.message}` }, { status: 500 });
    }
    for (const p of data || []) created.set(p.code, p);
  }

  // 4. 更新既有人員的姓名 / QR
  for (const item of toUpdate) {
    const { error } = await admin
      .from('participants')
      .update({ name: item.name, qr_code: item.qr_code })
      .eq('id', item.id);
    if (error) {
      conflicts.push({ code: item.id, reason: `更新失敗：${error.message}` });
    }
  }

  // 5. 匯入批次
  const { data: batchRow, error: batchError } = await admin
    .from('import_batches')
    .insert({
      sub_event_id: subEventId,
      filename,
      mapping,
      row_count: rows.length,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (batchError) {
    return NextResponse.json({ error: `建立匯入批次失敗：${batchError.message}` }, { status: 500 });
  }

  // 6. 寫入名單
  const idByCode = new Map([...existing, ...created].map(([code, p]) => [code, p.id]));
  for (const [code, p] of created) idByCode.set(code, p.id);

  const registrations = [];
  for (const row of rows) {
    const participantId = idByCode.get(row.code);
    if (!participantId) continue;
    registrations.push({
      sub_event_id: subEventId,
      participant_id: participantId,
      team: row.team,
      extra: row.extra,
      import_batch_id: batchRow.id,
    });
  }

  // 已存在的名單：保留報到狀態，只更新組別與自訂欄位
  const { data: already } = await admin
    .from('registrations')
    .select('participant_id')
    .eq('sub_event_id', subEventId);
  const alreadySet = new Set((already || []).map((r) => r.participant_id));

  let createdCount = 0;
  let updatedCount = 0;

  for (const batch of chunked(registrations)) {
    const { error } = await admin
      .from('registrations')
      .upsert(batch, { onConflict: 'sub_event_id,participant_id' });
    if (error) {
      return NextResponse.json({ error: `寫入名單失敗：${error.message}` }, { status: 500 });
    }
    for (const r of batch) {
      if (alreadySet.has(r.participant_id)) updatedCount += 1;
      else createdCount += 1;
    }
  }

  await admin
    .from('import_batches')
    .update({ created_count: createdCount, updated_count: updatedCount })
    .eq('id', batchRow.id);

  return NextResponse.json({
    ok: true,
    batch_id: batchRow.id,
    created: createdCount,
    updated: updatedCount,
    new_participants: created.size,
    conflicts,
  });
}
