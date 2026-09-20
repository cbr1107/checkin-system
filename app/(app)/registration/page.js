import { redirect } from 'next/navigation';
import { requireUser, canUseRegistrationCenter } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { atLeast } from '@/lib/constants';
import RegistrationCenter from './RegistrationCenter';

export const dynamic = 'force-dynamic';

export default async function RegistrationPage() {
  const profile = await requireUser();

  if (!(await canUseRegistrationCenter(profile))) {
    redirect('/dashboard?error=forbidden');
  }

  const supabase = createClient();
  const isLead = atLeast(profile.role, 'lead');

  const [{ data: allEvents }, { data: staffUsers }, { data: myGrants }] = await Promise.all([
    supabase
      .from('sub_events')
      .select('*')
      .order('starts_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }),
    isLead
      ? supabase
          .from('app_users')
          .select('id, display_name, account')
          .eq('role', 'staff')
          .eq('is_active', true)
      : Promise.resolve({ data: [] }),
    profile.role === 'staff'
      ? supabase
          .from('sub_event_grants')
          .select('sub_event_id')
          .eq('user_id', profile.id)
          .eq('can_edit_roster', true)
      : Promise.resolve({ data: [] }),
  ]);

  // 註冊組員只看得到被授權、或開放給全部組員的活動
  let events = allEvents || [];
  if (profile.role === 'staff') {
    const granted = new Set((myGrants || []).map((g) => g.sub_event_id));
    events = events.filter((ev) => granted.has(ev.id) || ev.open_to_all_staff);
  }

  return (
    <main className="page">
      <RegistrationCenter
        profile={profile}
        initialEvents={events}
        staffUsers={staffUsers || []}
      />
    </main>
  );
}
