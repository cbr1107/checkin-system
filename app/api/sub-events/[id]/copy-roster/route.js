import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/** 從另一個子活動複製名單 */
export async function POST(request, { params }) {
  const targetId = params.id;
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '尚未登入' }, { status: 401 });

  const { data: allowed } = await supabase.rpc('can_edit_roster', { target: targetId });
  if (!allowed) {
    return NextResponse.json({ error: '你沒有編輯這個子活動名單的權限' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const sourceId = body.source_id;
  const includeTeam = body.include_team !== false;

  if (!sourceId || sourceId === targetId) {
    return NextResponse.json({ error: '請選擇另一個子活動作為來源' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: source, error: sourceError } = await admin
    .from('registrations')
    .select('participant_id, team, extra')
    .eq('sub_event_id', sourceId);

  if (sourceError) {
    return NextResponse.json({ error: sourceError.message }, { status: 500 });
  }
  if (!source || source.length === 0) {
    return NextResponse.json({ error: '來源活動沒有名單' }, { status: 400 });
  }

  const { data: existing } = await admin
    .from('registrations')
    .select('participant_id')
    .eq('sub_event_id', targetId);
  const already = new Set((existing || []).map((r) => r.participant_id));

  const { data: sourceEvent } = await admin
    .from('sub_events')
    .select('name')
    .eq('id', sourceId)
    .maybeSingle();

  const { data: batch } = await admin
    .from('import_batches')
    .insert({
      sub_event_id: targetId,
      filename: `複製自「${sourceEvent?.name || '其他活動'}」`,
      mapping: { source_id: sourceId, include_team: includeTeam },
      row_count: source.length,
      created_by: user.id,
    })
    .select('id')
    .single();

  const rows = source.map((r) => ({
    sub_event_id: targetId,
    participant_id: r.participant_id,
    team: includeTeam ? r.team : null,
    extra: r.extra || {},
    import_batch_id: batch?.id || null,
  }));

  const { error: upsertError } = await admin
    .from('registrations')
    .upsert(rows, { onConflict: 'sub_event_id,participant_id' });

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  const created = rows.filter((r) => !already.has(r.participant_id)).length;
  const updated = rows.length - created;

  await admin
    .from('import_batches')
    .update({ created_count: created, updated_count: updated })
    .eq('id', batch.id);

  return NextResponse.json({ ok: true, created, updated });
}
