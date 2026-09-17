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
    .select('id, account, display_name, role, is_active, must_change_password, note, created_by, created_at')
    .order('created_at', { ascending: false });

  // 註冊長只看得到自己建立的報到人員
  if (profile.role === 'lead') {
    query = query.eq('created_by', profile.id).eq('role', 'checkin');
  }

  const { data: users } = await query;

  return (
    <main className="page">
      <div className="page-head">
        <h1>帳號管理</h1>
        <p>
          {profile.role === 'admin'
            ? '建立與管理所有身分的帳號。新帳號的初始密碼與帳號相同，使用者首次登入時必須自行更換。'
            : '建立與管理報到人員帳號。新帳號的初始密碼與帳號相同，使用者首次登入時必須自行更換。'}
        </p>
      </div>

      <UserManager
        me={profile}
        initialUsers={users || []}
        creatableRoles={CREATABLE_ROLES[profile.role] || []}
      />
    </main>
  );
}
