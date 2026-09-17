import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function CheckinIndexPage() {
  await requireUser();
  const supabase = createClient();

  const { data: events } = await supabase
    .from('sub_events')
    .select('id, name, location, starts_at, require_checkout')
    .eq('is_active', true)
    .order('starts_at', { ascending: true, nullsFirst: false });

  return (
    <main className="page">
      <div className="page-head">
        <h1>選擇要報到的子活動</h1>
        <p>選定後就會進入掃碼畫面。中途可以隨時退回這裡換活動。</p>
      </div>

      {(!events || events.length === 0) && (
        <div className="card">
          <div className="empty">目前沒有進行中的子活動。請聯絡註冊長建立。</div>
        </div>
      )}

      <div className="event-picker">
        {(events || []).map((ev) => (
          <Link key={ev.id} href={`/checkin/${ev.id}`} className="event-tile">
            <strong>{ev.name}</strong>
            <span>
              {ev.location || '未設定地點'}
              {ev.require_checkout ? ' · 需簽退' : ''}
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
