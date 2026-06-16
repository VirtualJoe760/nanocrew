import type { Metadata } from 'next';

import { Footer, Nav } from '../site-chrome';

export const metadata: Metadata = { title: 'Privacy Policy — Nano Crew' };

export default function Privacy() {
  return (
    <>
      <Nav />
      <main className="wrap prose">
        <h1>Privacy Policy</h1>
        <p className="updated">Last updated: June 2026 · Starter draft — review with counsel before launch.</p>

        <p>
          This policy explains what we collect, why, and your choices. It applies to the Nano Crew app
          and this website.
        </p>

        <h2>Information we collect</h2>
        <ul>
          <li><strong>Account info</strong> — name and email when you sign up or join the waitlist.</li>
          <li><strong>Brand &amp; content</strong> — the brands, products, and posts you create.</li>
          <li><strong>Payment info</strong> — processed securely at checkout; we never store full card numbers.</li>
          <li><strong>Usage data</strong> — basic analytics to operate and improve the Service.</li>
        </ul>

        <h2>How we use it</h2>
        <p>
          To provide the Service (generate your storefront, process orders and payouts, fulfill
          products), to communicate with you, and to keep the platform secure. We do not sell your
          personal information.
        </p>

        <h2>Sharing</h2>
        <p>
          We share data only with the service providers that operate the platform on our behalf — for
          checkout, fulfillment, and hosting — under agreements that protect your data.
        </p>

        <h2>Your choices</h2>
        <p>
          You can access, correct, or delete your account data, and unsubscribe from the waitlist at any
          time, by contacting us. We retain data only as long as needed to provide the Service or meet
          legal obligations.
        </p>

        <h2>Contact</h2>
        <p>
          Privacy questions or data requests: <a href="mailto:privacy@nanocrew.app">privacy@nanocrew.app</a>.
        </p>
      </main>
      <Footer />
    </>
  );
}
