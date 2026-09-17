import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeCode, normalizeQr, cleanText } from '@/lib/roster';

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
  const code = normalizeCode(body.code);
  const name = cleanText(body.name);
  const team = cleanText(body.team) || null;
  const qrCode = normalizeQr(body.qr_code) || code;

  if (!code || !name) {
    return NextResponse.json({ error: '編號與姓名為必填' }, { status: 400 });
  }

  const admin = createAdminClient();

  let { data: participant } = await admin
    .from('participants')
    .select('id, code, name, qr_code')
    .eq('code', code)
    .maybeSingle();

  if (!participant) {
    const { data: qrOwner } = await admin
      .from('participants')
      .select('code')
      .eq('qr_code', qrCode)
      .maybeSingle();
    if (qrOwner) {
      return NextResponse.json(
        { error: `這組 QR 內容已被編號 ${qrOwner.code} 使用` },
        { status: 409 }
      );
    }

    const { data, error } = await admin
      .from('participants')
      .insert({ code, name, qr_code: qrCode })
      .select('id')
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    participant = data;
  }

  const { error: regError } = await admin.from('registrations').upsert(
    {
      sub_event_id: subEventId,
      participant_id: participant.id,
      team,
    },
    { onConflict: 'sub_event_id,participant_id' }
  );

  if (regError) {
    return NextResponse.json({ error: regError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
