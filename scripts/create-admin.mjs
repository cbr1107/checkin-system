/**
 * 建立第一個系統管理員帳號。
 *
 * 用法：
 *   node scripts/create-admin.mjs <帳號> <姓名>
 *   例：node scripts/create-admin.mjs fxadmin 系統管理員
 *
 * 初始密碼與帳號相同，首次登入會強制要求變更。
 * 帳號至少 6 個字元（Supabase 密碼下限為 6，初始密碼即帳號）。
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

function loadEnv() {
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
    return true;
  } catch {
    console.error('找不到 .env.local，請先從 .env.local.example 複製一份並填入設定。');
    return false;
  }
}

async function main() {
  if (!loadEnv()) return 1;

  const [account, displayName] = process.argv.slice(2);
  if (!account || !displayName) {
    console.error('用法：node scripts/create-admin.mjs <帳號> <姓名>');
    return 1;
  }

  const normalized = account.trim().toLowerCase();
  if (!/^[A-Za-z0-9_]{6,20}$/.test(normalized)) {
    console.error('帳號限 6–20 字元，只能使用英文、數字與底線。');
    console.error('（初始密碼與帳號相同，而 Supabase 的密碼下限是 6 個字元。）');
    return 1;
  }

  const domain = process.env.NEXT_PUBLIC_ACCOUNT_EMAIL_DOMAIN || 'checkin.local';
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data, error } = await admin.auth.admin.createUser({
    email: `${normalized}@${domain}`,
    password: normalized,
    email_confirm: true,
    user_metadata: { account: normalized, display_name: displayName },
  });

  if (error) {
    console.error('建立失敗：', error.message);
    return 1;
  }

  const { error: profileError } = await admin.from('app_users').insert({
    id: data.user.id,
    account: normalized,
    display_name: displayName,
    role: 'admin',
    must_change_password: true,
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    console.error('寫入 app_users 失敗：', profileError.message);
    return 1;
  }

  console.log(`已建立系統管理員：${normalized}`);
  console.log(`初始密碼：${normalized}（首次登入會要求變更）`);
  return 0;
}

process.exitCode = await main();
