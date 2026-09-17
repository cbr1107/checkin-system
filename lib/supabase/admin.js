import { createClient } from '@supabase/supabase-js';

/** service_role 客戶端：僅限伺服器端，會繞過 RLS。 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('缺少 SUPABASE_SERVICE_ROLE_KEY 環境變數');

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
