import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { atLeast } from '@/lib/constants';

/** 讀取目前登入者的 app_users 資料；未登入回傳 null。 */
export async function getCurrentUser() {
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
}

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
