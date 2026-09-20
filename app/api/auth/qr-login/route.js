import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { accountToEmail } from '@/lib/account';
import { clientIpFrom, checkAndRecordIp } from '@/lib/loginIp';

/**
 * 以識別金鑰換取一次性登入憑證。
 *
 * 帳號狀態、IP 上限、金鑰驗證全部在這一趟完成，
 * 前端拿到回應後只需再建立 session，不必回頭補查。
 *
 * 失敗訊息一律相同——區分「查無此碼」與「帳號停用」
 * 等於提供了猜測金鑰的回饋管道。
 */
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const key = String(body.key || '').trim();

  const fail = () => NextResponse.json({ error: '這組識別碼無法登入' }, { status: 401 });

  if (key.length < 10 || key.length > 64) return fail();

  const admin = createAdminClient();
  const ip = clientIpFrom(request);
  const userAgent = (request.headers.get('user-agent') || '').slice(0, 300);

  // 設定與帳號同時查，不要一前一後
  const [settingRes, userRes] = await Promise.all([
    admin.from('app_settings').select('value').eq('key', 'qr_login').maybeSingle(),
    admin
      .from('app_users')
      .select('id, account, is_active, qr_login_enabled, must_change_password, max_ips')
      .eq('login_key', key)
      .maybeSingle(),
  ]);

  if (settingRes.data?.value?.enabled === false) {
    return NextResponse.json({ error: '系統目前未開放掃碼登入' }, { status: 403 });
  }

  const user = userRes.data;
  if (!user || !user.is_active || !user.qr_login_enabled) return fail();

  // 憑證與 IP 檢查併行
  const [linkRes, ipCheck] = await Promise.all([
    admin.auth.admin.generateLink({
      type: 'magiclink',
      email: accountToEmail(user.account),
    }),
    checkAndRecordIp(admin, user.id, user.max_ips ?? 0, ip, userAgent),
  ]);

  if (!ipCheck.allowed) {
    return NextResponse.json(
      {
        error: `這個帳號最多只能從 ${ipCheck.limit} 個網路位置登入，目前的位置（${ip}）不在其中。請聯絡管理員。`,
      },
      { status: 403 }
    );
  }

  if (linkRes.error || !linkRes.data?.properties?.hashed_token) return fail();

  return NextResponse.json({
    token_hash: linkRes.data.properties.hashed_token,
    must_change_password: user.must_change_password,
  });
}
