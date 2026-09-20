import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { accountToEmail, normalizeAccount, validateAccount } from '@/lib/account';
import { CREATABLE_ROLES } from '@/lib/constants';
import { generateLoginKey } from '@/lib/loginKey';

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

export async function POST(request) {
  const caller = await getCaller();
  if (!caller) {
    return NextResponse.json({ error: '尚未登入' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const account = normalizeAccount(body.account);
  const displayName = String(body.display_name || '').trim();
  const role = body.role;
  const note = String(body.note || '').trim() || null;

  const accountError = validateAccount(account);
  if (accountError) {
    return NextResponse.json({ error: accountError }, { status: 400 });
  }
  if (!displayName) {
    return NextResponse.json({ error: '請填寫姓名' }, { status: 400 });
  }
  if (!(CREATABLE_ROLES[caller.role] || []).includes(role)) {
    return NextResponse.json(
      { error: '你沒有建立這個身分帳號的權限' },
      { status: 403 }
    );
  }

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from('app_users')
    .select('id')
    .ilike('account', account)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: '這個帳號已經有人使用' }, { status: 409 });
  }

  // 初始密碼與帳號相同，首次登入強制變更
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: accountToEmail(account),
    password: account,
    email_confirm: true,
    user_metadata: { account, display_name: displayName },
  });

  if (createError) {
    return NextResponse.json(
      { error: createError.message || '帳號建立失敗' },
      { status: 400 }
    );
  }

  const loginKey = generateLoginKey();

  const { error: profileError } = await admin.from('app_users').insert({
    id: created.user.id,
    account,
    display_name: displayName,
    role,
    note,
    must_change_password: true,
    created_by: caller.id,
    login_key: loginKey,
  });

  if (profileError) {
    // 回滾，避免留下孤兒 auth 使用者
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json(
      { error: profileError.message || '帳號資料寫入失敗' },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    account,
    initial_password: account,
    login_key: loginKey,
  });
}
