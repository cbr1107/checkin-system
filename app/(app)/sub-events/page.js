import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import SubEventList from './SubEventList';

export const dynamic = 'force-dynamic';

export default async function SubEventsPage() {
  await requireRole('lead');
  const supabase = createClient();

  // 統計改由資料庫聚合，不再把整份名單撈回前端計算
  const [{ data: events }, { data: stats }] = await Promise.all([
    supabase
      .from('sub_events')
      .select('id, name, location, starts_at, ends_at, require_checkout, is_active')
      .order('starts_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false }),
    supabase.from('sub_event_stats').select('sub_event_id, total, checked_in'),
  ]);

  const tally = {};
  for (const row of stats || []) {
    tally[row.sub_event_id] = { total: row.total, checkedIn: row.checked_in };
  }

  return (
    <main className="page">
      <div className="page-head">
        <h1>子活動</h1>
      </div>

      <SubEventList initialEvents={events || []} counts={tally} />
    </main>
  );
}
