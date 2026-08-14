import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ops Console',
  description: 'Exception queue, procurement copilot and reconciliation.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>
        <div className="app">
          <header className="topbar">
            <span className="brand">XB Ops</span>
            <Link href="/">Queue</Link>
            <Link href="/orders/">Orders</Link>
            <Link href="/finance/">Finance</Link>
            <span className="spacer" />
          </header>
          <div className="wrap">{children}</div>
        </div>
      </body>
    </html>
  );
}
