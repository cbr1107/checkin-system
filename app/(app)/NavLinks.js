'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function NavLinks({ links }) {
  const pathname = usePathname();

  return (
    <nav>
      {links.map((link) => {
        const active =
          pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link key={link.href} href={link.href} data-active={active || undefined}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
