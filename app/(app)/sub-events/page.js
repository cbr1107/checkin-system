import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import SubEventList from './SubEventList';

export const dynamic = 'force-dynamic';

export default async function SubEventsPage() {
  await requireRole('lead');
  const supabase = createClient();

  const { data: events } = await supabase
    .from('sub_events')
    .select('id, name, location, starts_at, ends_at, require_checkout, is_active')
    .order('starts_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  const { data: counts } = await supabase
    .from('registrations')
    .select('sub_event_id');

  const tally = {};
  for (const row of counts || []) {
    tally[row.sub_event_id] = (tally[row.sub_event_id] || 0) + 1;
  }

  return (
    <main className="page">
      <div className="page-head">
        <h1>子活動</h1>
        <p>每個子活動有自己的名單與組別。需要記錄離場時間的活動，請開啟簽退。</p>
      </div>

      <SubEventList initialEvents={events || []} counts={tally} />
    </main>
  );
}
