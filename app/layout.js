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
      <head>
        {/*
          標題用明體（Noto Serif TC），內文用黑體。
          以 link 載入而非 next/font，網路不通時會退回系統字型，
          不會讓建置失敗。
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&family=Noto+Serif+TC:wght@500;600;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
