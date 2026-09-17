import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ROLE_LABELS, atLeast } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({ searchParams }) {
  const profile = await requireUser();
  const supabase = createClient();

  const { data: events } = await supabase
    .from('sub_events')
    .select('id, name, location, require_checkout')
    .eq('is_active', true)
    .order('starts_at', { ascending: true, nullsFirst: false })
    .limit(6);

  const { data: stats } = await supabase
    .from('sub_event_stats')
    .select('sub_event_id, total, checked_in');

  const tally = {};
  for (const row of stats || []) tally[row.sub_event_id] = row;

  return (
    <main className="page">
      {searchParams?.error === 'forbidden' && (
        <div className="notice notice-error">你沒有存取該頁面的權限。</div>
      )}

      <div className="page-head">
        <h1>{profile.display_name}，歡迎回來</h1>
      </div>

      {events && events.length > 0 ? (
        <div className="event-picker">
          {events.map((ev) => (
            <Link key={ev.id} href={`/checkin/${ev.id}`} className="event-tile">
              <strong>{ev.name}</strong>
              <span>
                已報到 {tally[ev.id]?.checked_in ?? 0}／{tally[ev.id]?.total ?? 0}
                {ev.require_checkout ? ' · 需簽退' : ''}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="card">
          <div className="empty">
            目前沒有進行中的子活動。
            {atLeast(profile.role, 'lead') && (
              <>
                {' '}
                <Link href="/sub-events">建立一個</Link>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
