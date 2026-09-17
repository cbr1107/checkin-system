import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { atLeast } from '@/lib/constants';
import RecordsView from './RecordsView';

export const dynamic = 'force-dynamic';

export default async function RecordsPage() {
  const profile = await requireUser();
  const supabase = createClient();

  const { data: events } = await supabase
    .from('sub_events')
    .select('id, name, require_checkout, is_active')
    .order('starts_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  return (
    <main className="page">
      <div className="page-head">
        <h1>報到紀錄</h1>
        <p>
          {atLeast(profile.role, 'staff')
            ? '選擇子活動查看即時進度與逐筆紀錄。畫面會隨現場報到自動更新。'
            : '這裡顯示你自己經手的報到紀錄。'}
        </p>
      </div>

      <RecordsView profile={profile} events={events || []} />
    </main>
  );
}
