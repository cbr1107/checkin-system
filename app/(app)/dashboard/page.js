import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ROLE_LABELS, atLeast } from '@/lib/constants';

export default async function DashboardPage({ searchParams }) {
  const profile = await requireUser();
  const supabase = createClient();

  const { count: eventCount } = await supabase
    .from('sub_events')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true);

  return (
    <main className="page">
      {searchParams?.error === 'forbidden' && (
        <div className="notice notice-error">你沒有存取該頁面的權限。</div>
      )}

      <div className="page-head">
        <h1>{profile.display_name}，歡迎回來</h1>
        <p>
          目前身分為{ROLE_LABELS[profile.role]}。系統中有 {eventCount ?? 0} 個進行中的子活動。
        </p>
      </div>

      <div className="card">
        <h3>建置進度</h3>
        <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--muted)' }}>
          <li>
            P1 帳號與權限 — 已完成（
            {atLeast(profile.role, 'lead') ? (
              <Link href="/admin/users">帳號管理</Link>
            ) : (
              '由註冊長以上管理'
            )}
            ）
          </li>
          <li>P2 子活動與名單匯入 — 建置中</li>
          <li>P3 現場報到與簽退 — 待建置</li>
          <li>P4 離線快取與同步 — 待建置</li>
          <li>P5 儀表板與匯出 — 待建置</li>
        </ul>
      </div>
    </main>
  );
}
