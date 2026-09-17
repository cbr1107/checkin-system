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
                <span className="auth-line">先設定</span>
                <span className="auth-line">你的密碼</span>
              </>
            ) : (
              <>
                <span className="auth-line">變更</span>
                <span className="auth-line">密碼</span>
              </>
            )}
          </h1>
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
