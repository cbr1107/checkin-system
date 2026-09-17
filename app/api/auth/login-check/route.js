import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

function clientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return (
    request.headers.get('x-real-ip') ||
    request.headers.get('cf-connecting-ip') ||
    'unknown'
  );
}

/**
 * 登入後檢查 IP 數量上限。
 * 由前端在登入成功後立即呼叫；被拒絕時前端會登出。
 */
export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ allowed: false, reason: 'unauthenticated' }, { status: 401 });

  const ip = clientIp(request);
  const userAgent = (request.headers.get('user-agent') || '').slice(0, 300);
  const admin = createAdminClient();

  const { data: profile, error: profileError } = await admin
    .from('app_users')
    .select('max_ips')
    .eq('id', user.id)
    .maybeSingle();

  // 欄位或資料表還沒建立時，放行但明講檢查沒生效，避免把人擋在門外又查不出原因
  if (profileError) {
    return NextResponse.json({
      allowed: true,
      ip,
      warning: 'check_unavailable',
      detail: profileError.message,
    });
  }

  const limit = profile?.max_ips ?? 0;

  const { data: known } = await admin
    .from('login_ips')
    .select('id')
    .eq('user_id', user.id)
    .eq('ip', ip)
    .maybeSingle();

  // 已經記錄過的 IP：更新時間就好，不受上限影響
  if (known) {
    await admin
      .from('login_ips')
      .update({ last_seen: new Date().toISOString(), user_agent: userAgent })
      .eq('id', known.id);
    return NextResponse.json({ allowed: true, ip });
  }

  if (limit > 0) {
    const { count } = await admin
      .from('login_ips')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if ((count ?? 0) >= limit) {
      return NextResponse.json({
        allowed: false,
        reason: 'ip_limit',
        ip,
        limit,
      });
    }
  }

  await admin.from('login_ips').insert({ user_id: user.id, ip, user_agent: userAgent });

  return NextResponse.json({ allowed: true, ip });
}
