import type { Metadata } from 'next';

import { Footer, Nav } from '../site-chrome';

export const metadata: Metadata = { title: 'Terms of Service — Nanocrew' };

export default function Terms() {
  return (
    <>
      <Nav />
      <main className="wrap prose">
        <h1>Terms of Service</h1>
        <p className="updated">Last updated: June 2026 · Starter draft — review with counsel before launch.</p>

        <p>
          These Terms govern your use of Nanocrew (the &ldquo;Service&rdquo;), operated by Nanocrew
          (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By creating an account or using the Service you agree to these Terms.
        </p>

        <h2>1. The Service</h2>
        <p>
          Nanocrew lets creators design and run a clothing brand: it generates a storefront and lists
          products that our online fulfillment prints and ships when they sell, with payments handled at
          checkout. Creators are responsible for the brands, content, and products they publish.
        </p>

        <h2>2. Accounts &amp; subscriptions</h2>
        <p>
          Some features require a paid subscription, billed in advance on a recurring basis. You can
          cancel at any time; access continues until the end of the current billing period. Fees are
          non-refundable except where required by law or stated in our refund policy below.
        </p>

        <h2>3. Payments &amp; payouts</h2>
        <p>
          When you sell through your storefront, you are the merchant of record for those sales;
          Nanocrew collects a platform fee on each transaction, and payments are processed securely at
          checkout. You are responsible for taxes on your sales.
        </p>

        <h2>4. Orders, fulfillment &amp; refunds</h2>
        <p>
          Products are made to order — when you make a sale, our online fulfillment prints your design
          and ships it. Because items are produced on demand, returns are limited to defective or
          misprinted goods. Refund and replacement requests should be sent to support within 30 days of
          delivery.
        </p>

        <h2>5. Acceptable use</h2>
        <p>
          You may not use the Service to infringe others&rsquo; rights, sell prohibited or unlawful
          goods, or upload content you don&rsquo;t have the right to use. We may suspend brands that
          violate these Terms.
        </p>

        <h2>6. Disclaimers &amp; liability</h2>
        <p>
          The Service is provided &ldquo;as is.&rdquo; To the maximum extent permitted by law, our
          liability is limited to the amount you paid us in the prior twelve months.
        </p>

        <h2>7. Contact</h2>
        <p>
          Questions about these Terms: <a href="mailto:support@nanocrew.app">support@nanocrew.app</a>.
        </p>
      </main>
      <Footer />
    </>
  );
}
