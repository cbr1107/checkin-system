export const dynamic = 'force-dynamic';

import LoginForm from './LoginForm';
import { APP_NAME, ORG_NAME, APP_VERSION } from '@/lib/constants';

export default function LoginPage({ searchParams }) {
  const error =
    searchParams?.error === 'disabled'
      ? '此帳號已停用，請聯絡系統管理員。'
      : null;

  return (
    <main className="auth-shell">
      <section className="auth-brand">
        <div>
          <h1>
            現場
            <br />
            報到系統
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
