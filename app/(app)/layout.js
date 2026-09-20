import { headers } from 'next/headers';
import { requireUser, getSettings } from '@/lib/auth';
import { ROLE_LABELS, APP_VERSION, APP_VERSION_DATE, atLeast } from '@/lib/constants';
import UiProvider from '@/components/ui/UiProvider';
import SignOutButton from './SignOutButton';
import OfflineReady from './OfflineReady';
import NavProgress from './NavProgress';
import NavLinks from './NavLinks';
import ThemeToggle from './ThemeToggle';
import IdleProvider, { IdleCountdown } from './IdleLogout';

const ORDER = [
  '/dashboard',
  '/registration',
  '/checkin',
  '/sub-events',
  '/records',
  '/admin/users',
  '/admin/settings',
];

function clientIp() {
  const h = headers();
  const forwarded = h.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return h.get('x-real-ip') || h.get('cf-connecting-ip') || '本機';
}

export default async function AppLayout({ children }) {
  const profile = await requireUser();
  const settings = await getSettings();
  const ip = clientIp();

  const centerRoles = settings.registration_center?.roles || ['admin', 'lead'];

  const links = [
    { href: '/dashboard', label: '總覽', min: 'checkin' },
    { href: '/checkin', label: '現場報到', min: 'checkin' },
    { href: '/sub-events', label: '子活動', min: 'lead' },
    { href: '/records', label: '報到紀錄', min: 'checkin' },
    { href: '/admin/users', label: '帳號管理', min: 'lead' },
    { href: '/admin/settings', label: '系統設定', min: 'admin' },
  ]
    .filter((l) => atLeast(profile.role, l.min))
    .concat(
      centerRoles.includes(profile.role)
        ? [{ href: '/registration', label: '註冊作業' }]
        : []
    )
    .sort((a, b) => ORDER.indexOf(a.href) - ORDER.indexOf(b.href));

  return (
    <UiProvider>
      <IdleProvider>
        <NavProgress />

        <header className="topbar">
          <span className="brand">現場報到</span>
          <NavLinks links={links} />
          <div className="who">
            <IdleCountdown />
            <span className="who-name">{profile.display_name}</span>
            <span className="badge">{ROLE_LABELS[profile.role]}</span>
            <ThemeToggle />
            <SignOutButton />
          </div>
        </header>

        {children}
        <OfflineReady />

        <span className="version">
          {APP_VERSION} · {APP_VERSION_DATE} · IP {ip}
        </span>
      </IdleProvider>
    </UiProvider>
  );
}
