import Link from 'next/link';
import { headers } from 'next/headers';
import { requireUser } from '@/lib/auth';
import { ROLE_LABELS, APP_VERSION, APP_VERSION_DATE, atLeast } from '@/lib/constants';
import SignOutButton from './SignOutButton';
import OfflineReady from './OfflineReady';

function clientIp() {
  const h = headers();
  const forwarded = h.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return h.get('x-real-ip') || h.get('cf-connecting-ip') || '本機';
}

export default async function AppLayout({ children }) {
  const profile = await requireUser();
  const ip = clientIp();

  const links = [
    { href: '/dashboard', label: '總覽', min: 'checkin' },
    { href: '/checkin', label: '現場報到', min: 'checkin' },
    { href: '/sub-events', label: '子活動', min: 'lead' },
    { href: '/records', label: '報到紀錄', min: 'checkin' },
    { href: '/admin/users', label: '帳號管理', min: 'lead' },
    { href: '/admin/settings', label: '系統設定', min: 'admin' },
  ].filter((l) => atLeast(profile.role, l.min));

  return (
    <>
      <header className="topbar">
        <span className="brand">現場報到</span>
        <nav>
          {links.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="who">
          <span>{profile.display_name}</span>
          <span className="role-chip">{ROLE_LABELS[profile.role]}</span>
          <SignOutButton />
        </div>
      </header>

      {children}
      <OfflineReady />

      <span className="version">
        {APP_VERSION} · {APP_VERSION_DATE} · IP {ip}
      </span>
    </>
  );
}