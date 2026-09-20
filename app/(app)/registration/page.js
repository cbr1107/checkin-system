import { redirect } from 'next/navigation';
import { requireUser, getSettings } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { atLeast } from '@/lib/constants';
import RegistrationCenter from './RegistrationCenter';

export const dynamic = 'force-dynamic';

export default async function RegistrationPage() {
  const profile = await requireUser();
  const settings = await getSettings();

  const allowedRoles = settings.registration_center?.roles || ['admin', 'lead'];
  if (!allowedRoles.includes(profile.role)) redirect('/dashboard?error=forbidden');

  const supabase = createClient();

  const [{ data: events }, { data: staffUsers }] = await Promise.all([
    supabase
      .from('sub_events')
      .select('*')
      .order('starts_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }),
    atLeast(profile.role, 'lead')
      ? supabase
          .from('app_users')
          .select('id, display_name, account')
          .eq('role', 'staff')
          .eq('is_active', true)
      : Promise.resolve({ data: [] }),
  ]);

  return (
    <main className="page">
      <div className="page-head">
        <h1>註冊作業中心</h1>
      </div>

      <RegistrationCenter
        profile={profile}
        initialEvents={events || []}
        staffUsers={staffUsers || []}
      />
    </main>
  );
}
