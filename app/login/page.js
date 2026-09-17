export const dynamic = 'force-dynamic';

import LoginForm from './LoginForm';
import { APP_NAME, ORG_NAME, APP_VERSION } from '@/lib/constants';

export default function LoginPage({ searchParams }) {
  const error =
    searchParams?.error === 'disabled'
      ? '此帳號已停用，請聯絡系統管理員。'
      : searchParams?.reason === 'idle'
        ? '因閒置過久已自動登出，請重新登入。'
        : null;

  return (
    <main className="auth-shell">
      <section className="auth-brand">
        <div>
          <h1>
            <span className="auth-line">現場</span>
            <span className="auth-line">報到系統</span>
          </h1>
        </div>
        <footer>
          {ORG_NAME} · {APP_VERSION}
        </footer>
      </section>

      <section className="auth-panel">
        <LoginForm initialError={error} appName={APP_NAME} />
      </section>
    </main>
  );
}
