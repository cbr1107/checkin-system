import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { ORG_NAME, APP_VERSION } from '@/lib/constants';
import ChangePasswordForm from './ChangePasswordForm';

export default async function ChangePasswordPage() {
  const profile = await getCurrentUser();
  if (!profile) redirect('/login');

  const forced = profile.must_change_password;

  return (
    <main className="auth-shell">
      <section className="auth-brand">
        <div>
          <h1>
            {forced ? (
              <>
                先設定
                <br />
                你的密碼
              </>
            ) : (
              <>
                變更
                <br />
                密碼
              </>
            )}
          </h1>
          <p>
            {forced
              ? '初始密碼與帳號相同，為確保帳戶使用安全，請先設定新密碼後才能開始使用系統。'
              : '變更後，其他裝置上的登入狀態仍會保留。'}
          </p>
        </div>
        <footer>
          {ORG_NAME} · {APP_VERSION}
        </footer>
      </section>

      <section className="auth-panel">
        <ChangePasswordForm
          account={profile.account}
          displayName={profile.display_name}
          forced={forced}
        />
      </section>
    </main>
  );
}
