import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { clientIpFrom, checkAndRecordIp } from '@/lib/loginIp';

/**
 * 帳號密碼登入後的檢查。
 * 一併回傳帳號狀態，前端不必再查一次 app_users。
 */
export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ allowed: false, reason: 'unauthenticated' }, { status: 401 });
  }

  const ip = clientIpFrom(request);
  const userAgent = (request.headers.get('user-agent') || '').slice(0, 300);
  const admin = createAdminClient();

  const { data: profile, error } = await admin
    .from('app_users')
    .select('max_ips, is_active, must_change_password')
    .eq('id', user.id)
    .maybeSingle();

  // 欄位或資料表還沒建立時放行，但明講檢查沒生效
  if (error) {
    return NextResponse.json({ allowed: true, ip, warning: 'check_unavailable' });
  }

  if (!profile?.is_active) {
    return NextResponse.json({ allowed: false, reason: 'inactive', ip });
  }

  const result = await checkAndRecordIp(admin, user.id, profile.max_ips ?? 0, ip, userAgent);

  if (!result.allowed) {
    return NextResponse.json({ allowed: false, reason: result.reason, limit: result.limit, ip });
  }

  return NextResponse.json({
    allowed: true,
    ip,
    must_change_password: profile.must_change_password,
  });
}
