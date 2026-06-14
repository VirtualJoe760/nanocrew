import type { Metadata } from 'next';

import { Footer, Nav } from '../../site-chrome';

export const metadata: Metadata = { title: 'Payouts set up — Nanocrew' };

// Where Stripe sends a creator after they finish payout (Connect) onboarding.
export default function ConnectReturn() {
  return (
    <>
      <Nav />
      <main className="wrap prose">
        <h1>You&rsquo;re all set</h1>
        <p>
          Thanks for setting up payouts. Stripe is reviewing your details — once you&rsquo;re verified,
          your brand can take its own sales and the money lands in your account automatically.
        </p>
        <p>
          Head back to the <strong>Nanocrew app</strong> to finish launching your store. Your payout
          status updates there under <em>Account → Payouts</em>.
        </p>
        <p className="updated" style={{ marginTop: 36 }}>
          You can close this tab.
        </p>
      </main>
      <Footer />
    </>
  );
}
