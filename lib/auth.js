import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { atLeast } from '@/lib/constants';

/**
 * 讀取目前登入者。
 * 用 React cache 包起來：同一次請求中版面與頁面都會呼叫，
 * 沒有快取就會對 Supabase 打兩次，頁面切換明顯變慢。
 */
export const getCurrentUser = cache(async () => {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('app_users')
    .select('id, account, display_name, role, is_active, must_change_password')
    .eq('id', user.id)
    .single();

  return profile || null;
});

/** 讀取全域設定，同一次請求只查一次 */
export const getSettings = cache(async () => {
  const supabase = createClient();
  const { data } = await supabase.from('app_settings').select('key, value');
  const map = {};
  for (const row of data || []) map[row.key] = row.value;
  return map;
});

/** 要求已登入、已啟用、已改過預設密碼，否則導向。 */
export async function requireUser() {
  const profile = await getCurrentUser();
  if (!profile) redirect('/login');
  if (!profile.is_active) redirect('/login?error=disabled');
  if (profile.must_change_password) redirect('/change-password');
  return profile;
}

/** 要求至少某個角色層級。 */
export async function requireRole(minRole) {
  const profile = await requireUser();
  if (!atLeast(profile.role, minRole)) redirect('/dashboard?error=forbidden');
  return profile;
}
