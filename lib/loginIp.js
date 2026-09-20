/** 登入時的 IP 記錄與數量檢查（供各登入路徑共用） */

export function clientIpFrom(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return (
    request.headers.get('x-real-ip') || request.headers.get('cf-connecting-ip') || 'unknown'
  );
}

/**
 * 檢查並記錄登入來源 IP。
 * maxIps 為 0 表示不限制。已記錄過的 IP 不受上限影響。
 */
export async function checkAndRecordIp(admin, userId, maxIps, ip, userAgent) {
  const { data: known } = await admin
    .from('login_ips')
    .select('id')
    .eq('user_id', userId)
    .eq('ip', ip)
    .maybeSingle();

  if (known) {
    await admin
      .from('login_ips')
      .update({ last_seen: new Date().toISOString(), user_agent: userAgent })
      .eq('id', known.id);
    return { allowed: true };
  }

  if (maxIps > 0) {
    const { count } = await admin
      .from('login_ips')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    if ((count ?? 0) >= maxIps) {
      return { allowed: false, reason: 'ip_limit', limit: maxIps };
    }
  }

  await admin.from('login_ips').insert({ user_id: userId, ip, user_agent: userAgent });
  return { allowed: true };
}
