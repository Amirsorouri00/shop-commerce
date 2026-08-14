import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import { DemoPanel } from '../components/DemoPanel';

export const metadata: Metadata = {
  title: 'خرید از خارج | سفارش آسان کالا از آمازون',
  description:
    'لینک کالای موردنظرتان را از فروشگاه‌های خارجی بفرستید، قیمت نهایی را به تومان ببینید و سفارش را تا درب منزل دریافت کنید.',
};

export const viewport: Viewport = {
  themeColor: '#1b3a6b',
  width: 'device-width',
  initialScale: 1,
  // Not locked: pinch-zoom is an accessibility affordance, and disabling it to make an app
  // "feel native" takes that away from the people who need it most.
  maximumScale: 5,
};

/**
 * Root layout.
 *
 * `lang="fa"` and `dir="rtl"` are set here rather than toggled at runtime, because Persian
 * RTL is the product's default rather than a preference. English strings inside the page
 * carry their own isolation (see the `.ltr` and `.mono` helpers in globals.css).
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <div className="shell">
          <header className="topbar">
            <div className="container topbar-inner">
              <Link href="/" className="brand">
                <span className="brand-mark" aria-hidden="true">
                  ✦
                </span>
                <span>سفارش از خارج</span>
              </Link>

              <nav className="topbar-spacer row">
                <Link href="/orders" className="btn btn-ghost btn-sm">
                  سفارش‌های من
                </Link>
              </nav>
            </div>
          </header>

          <main>
            <div className="container">{children}</div>
          </main>

          <footer className="container" style={{ paddingBlock: '20px' }}>
            <p className="muted" style={{ textAlign: 'center', margin: 0 }}>
              پرداخت به تومان · تحویل در ایران · پیگیری لحظه‌ای
            </p>
          </footer>
        </div>

        {/* Demo controls. Renders only when the sandbox is reachable. */}
        <DemoPanel />
      </body>
    </html>
  );
}
