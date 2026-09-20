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

/**
 * 能不能進註冊作業中心。
 * 系統設定開放的身分可以進；註冊組員即使不在清單中，
 * 只要被授權過任一活動（或有活動開放全部組員）也能進——
 * 註冊長既然授權了，就該讓他有地方操作。
 */
export const canUseRegistrationCenter = cache(async (profile) => {
  const settings = await getSettings();
  const roles = settings.registration_center?.roles || ['admin', 'lead'];
  if (roles.includes(profile.role)) return true;
  if (profile.role !== 'staff') return false;

  const supabase = createClient();
  const [granted, open] = await Promise.all([
    supabase
      .from('sub_event_grants')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .eq('can_edit_roster', true),
    supabase
      .from('sub_events')
      .select('id', { count: 'exact', head: true })
      .eq('open_to_all_staff', true)
      .eq('is_active', true),
  ]);

  return (granted.count ?? 0) > 0 || (open.count ?? 0) > 0;
});
