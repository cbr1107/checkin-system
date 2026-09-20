import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { atLeast } from '@/lib/constants';
import SubEventDetail from './SubEventDetail';

export const dynamic = 'force-dynamic';

export default async function SubEventPage({ params }) {
  const profile = await requireUser();
  const supabase = createClient();

  const { data: event } = await supabase
    .from('sub_events')
    .select('*')
    .eq('id', params.id)
    .maybeSingle();

  if (!event) notFound();

  const { data: registrations } = await supabase
    .from('registrations')
    .select('id, team, extra, checked_in_at, checked_out_at, participants(id, code, name, qr_code)')
    .eq('sub_event_id', params.id)
    .order('team', { ascending: true, nullsFirst: false })
    .limit(2000);

  const { data: batches } = await supabase
    .from('import_batches')
    .select('id, filename, row_count, created_count, updated_count, created_at, undone_at')
    .eq('sub_event_id', params.id)
    .order('created_at', { ascending: false })
    .limit(10);

  const { data: grants } = await supabase
    .from('sub_event_grants')
    .select(
      'id, user_id, can_edit_roster, can_export, app_users!sub_event_grants_user_id_fkey(display_name, account, role)'
    )
    .eq('sub_event_id', params.id);

  const { data: staffUsers } = atLeast(profile.role, 'lead')
    ? await supabase
        .from('app_users')
        .select('id, display_name, account')
        .eq('role', 'staff')
        .eq('is_active', true)
    : { data: [] };

  const { data: canEdit } = await supabase.rpc('can_edit_roster', {
    target: params.id,
  });

  return (
    <SubEventDetail
      profile={profile}
      event={event}
      registrations={registrations || []}
      batches={batches || []}
      grants={grants || []}
      staffUsers={staffUsers || []}
      canEdit={Boolean(canEdit)}
    />
  );
}
