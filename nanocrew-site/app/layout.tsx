import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || 'https://nanocrew.app'),
  title: 'Nanocrew — speak your brand into existence',
  description:
    'Nanocrew turns a conversation into a real clothing brand: a Printful-backed shop, a custom storefront website, and the content to sell it — generated for you, run from your phone.',
  openGraph: {
    title: 'Nanocrew',
    description: 'AI-native creator commerce. Talk to Venus; get a brand, a shop, and a website.',
    type: 'website',
  },
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
