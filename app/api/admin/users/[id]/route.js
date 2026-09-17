import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

async function getCaller() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('app_users')
    .select('id, role, is_active')
    .eq('id', user.id)
    .single();

  return data?.is_active ? data : null;
}

/**
 * 系統管理員：可管理所有帳號。
 * 註冊長：只能管理自己建立的報到人員帳號。
 */
function canManage(caller, target) {
  if (caller.role === 'admin') return caller.id !== target.id;
  if (caller.role === 'lead') {
    return target.role === 'checkin' && target.created_by === caller.id;
  }
  return false;
}

async function loadTarget(admin, id) {
  const { data } = await admin
    .from('app_users')
    .select('id, account, role, created_by, is_active')
    .eq('id', id)
    .maybeSingle();
  return data;
}

export async function PATCH(request, { params }) {
  const caller = await getCaller();
  if (!caller) return NextResponse.json({ error: '尚未登入' }, { status: 401 });

  const admin = createAdminClient();
  const target = await loadTarget(admin, params.id);
  if (!target) return NextResponse.json({ error: '找不到這個帳號' }, { status: 404 });
  if (!canManage(caller, target)) {
    return NextResponse.json({ error: '你沒有管理這個帳號的權限' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));

  if (body.action === 'reset_password') {
    const { error } = await admin.auth.admin.updateUserById(target.id, {
      password: target.account,
    });
    if (error) {
      return NextResponse.json({ error: '密碼重設失敗' }, { status: 400 });
    }
    await admin
      .from('app_users')
      .update({ must_change_password: true })
      .eq('id', target.id);

    return NextResponse.json({ ok: true, initial_password: target.account });
  }

  if (body.action === 'set_active') {
    await admin
      .from('app_users')
      .update({ is_active: Boolean(body.is_active) })
      .eq('id', target.id);
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'set_max_ips') {
    if (caller.role !== 'admin') {
      return NextResponse.json({ error: '只有系統管理員能設定 IP 上限' }, { status: 403 });
    }
    const value = Number(body.max_ips);
    if (!Number.isInteger(value) || value < 0 || value > 50) {
      return NextResponse.json({ error: 'IP 上限需為 0 到 50 的整數' }, { status: 400 });
    }
    await admin.from('app_users').update({ max_ips: value }).eq('id', target.id);
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'reset_ips') {
    await admin.from('login_ips').delete().eq('user_id', target.id);
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'set_role') {
    if (caller.role !== 'admin') {
      return NextResponse.json({ error: '只有系統管理員能變更身分' }, { status: 403 });
    }
    if (!['admin', 'lead', 'staff', 'checkin'].includes(body.role)) {
      return NextResponse.json({ error: '身分不正確' }, { status: 400 });
    }
    await admin.from('app_users').update({ role: body.role }).eq('id', target.id);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: '不支援的操作' }, { status: 400 });
}

export async function DELETE(request, { params }) {
  const caller = await getCaller();
  if (!caller) return NextResponse.json({ error: '尚未登入' }, { status: 401 });

  const admin = createAdminClient();
  const target = await loadTarget(admin, params.id);
  if (!target) return NextResponse.json({ error: '找不到這個帳號' }, { status: 404 });
  if (!canManage(caller, target)) {
    return NextResponse.json({ error: '你沒有管理這個帳號的權限' }, { status: 403 });
  }

  const { error } = await admin.auth.admin.deleteUser(target.id);
  if (error) {
    return NextResponse.json({ error: '刪除失敗' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
