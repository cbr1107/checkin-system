import { notFound } from 'next/navigation';
import { requireUser, getSettings } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import CheckinConsole from './CheckinConsole';

export const dynamic = 'force-dynamic';

export default async function CheckinPage({ params }) {
  const profile = await requireUser();
  const supabase = createClient();

  const [{ data: event }, settings, { data: roster }] = await Promise.all([
    supabase
      .from('sub_events')
      .select('id, name, location, require_checkout, min_stay_minutes, display_fields, is_active')
      .eq('id', params.id)
      .maybeSingle(),
    getSettings(),
    supabase
      .from('registrations')
      .select('id, team, extra, checked_in_at, checked_out_at, participants(id, code, name, qr_code, extra)')
      .eq('sub_event_id', params.id)
      .limit(2000),
  ]);

  if (!event) notFound();

  return (
    <CheckinConsole
      profile={profile}
      event={event}
      globalFields={settings.display_fields || null}
      offlineEnabled={settings.offline_checkin?.enabled !== false}
      roster={roster || []}
    />
  );
}
