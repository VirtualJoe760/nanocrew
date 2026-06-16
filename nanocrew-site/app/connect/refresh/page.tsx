import type { Metadata } from 'next';

import { Footer, Nav } from '../../site-chrome';

export const metadata: Metadata = { title: 'Resume payout setup — Nano Crew' };

// Where Stripe sends a creator when their onboarding link expired or needs a restart.
export default function ConnectRefresh() {
  return (
    <>
      <Nav />
      <main className="wrap prose">
        <h1>Let&rsquo;s pick that back up</h1>
        <p>
          Your payout-setup link expired before you finished. No problem — open the{' '}
          <strong>Nano Crew app</strong>, go to <em>Account → Payouts</em>, and tap{' '}
          <em>Set up payouts</em> again to get a fresh link.
        </p>
        <p className="updated" style={{ marginTop: 36 }}>
          You can close this tab.
        </p>
      </main>
      <Footer />
    </>
  );
}
