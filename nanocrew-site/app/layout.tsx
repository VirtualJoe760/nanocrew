import type { Metadata } from 'next';
import localFont from 'next/font/local';

import './globals.css';
import { EveSky } from './eve-sky';
import { CartProvider } from './store/cart-store';

// Jost — the app's own typeface (assets/fonts, mirrored into app/fonts). Self-hosted so the site
// and the app render the same face; `display: swap` keeps first paint fast.
const jost = localFont({
  src: [
    { path: './fonts/Jost-Light.ttf', weight: '300', style: 'normal' },
    { path: './fonts/Jost-Regular.ttf', weight: '400', style: 'normal' },
    { path: './fonts/Jost-Medium.ttf', weight: '500', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-jost',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || 'https://nanocrew.app'),
  title: 'Nano Crew — speak your brand into existence',
  description:
    'Nano Crew turns a conversation into a real clothing brand: a shop, a custom storefront website, and the content to sell it — generated for you, run from your phone.',
  openGraph: {
    title: 'Nano Crew',
    description: 'AI-native creator commerce. Talk to Eve; get a brand, a shop, and a website.',
    type: 'website',
  },
  icons: { icon: '/nc-icon.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jost.variable}>
      <body>
        {/* Eve sits behind every page — the site's echo of the app's one persistent avatar. */}
        <EveSky />
        <CartProvider>{children}</CartProvider>
      </body>
    </html>
  );
}
