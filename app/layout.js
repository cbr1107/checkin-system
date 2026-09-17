import './globals.css';
import { APP_NAME, ORG_NAME } from '@/lib/constants';

export const metadata = {
  title: APP_NAME,
  description: `${ORG_NAME} ${APP_NAME}`,
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
