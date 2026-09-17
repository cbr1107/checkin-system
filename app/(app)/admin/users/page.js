import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { CREATABLE_ROLES } from '@/lib/constants';
import UserManager from './UserManager';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const profile = await requireRole('lead');
  const supabase = createClient();

  let query = supabase
    .from('app_users')
    .select('id, account, display_name, role, is_active, must_change_password, max_ips, note, created_by, created_at')
    .order('created_at', { ascending: false });

  // 註冊長只看得到自己建立的報到人員
  if (profile.role === 'lead') {
    query = query.eq('created_by', profile.id).eq('role', 'checkin');
  }

  const { data: users } = await query;

  const { data: ipRows } = await supabase
    .from('login_ips')
    .select('user_id, ip, last_seen')
    .order('last_seen', { ascending: false });

  const ipCounts = {};
  const ipList = {};
  for (const row of ipRows || []) {
    ipCounts[row.user_id] = (ipCounts[row.user_id] || 0) + 1;
    (ipList[row.user_id] ||= []).push(row.ip);
  }

  return (
    <main className="page">
      <div className="page-head">
        <h1>帳號管理</h1>
      </div>

      <UserManager
        me={profile}
        initialUsers={users || []}
        ipCounts={ipCounts}
        ipList={ipList}
        creatableRoles={CREATABLE_ROLES[profile.role] || []}
      />
    </main>
  );
}
