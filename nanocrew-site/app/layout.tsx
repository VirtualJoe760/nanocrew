import type { Metadata } from 'next';
import './globals.css';
import { CartProvider } from './store/cart-store';

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
    <html lang="en">
      <body>
        <CartProvider>{children}</CartProvider>
      </body>
    </html>
  );
}
