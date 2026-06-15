// Terms of Service — served at /terms (https://nanocrew-api.vercel.app/terms).
// PLACEHOLDERS to confirm before launch: {LEGAL_ENTITY}, {JURISDICTION} (governing law).
// Solid app-specific draft, not legal advice — have counsel review before launch.

export const metadata = {
  title: 'Terms of Service — Nanocrew',
  description: 'The terms that govern your use of Nanocrew.',
};

const EFFECTIVE = 'June 14, 2026';
const ENTITY = 'Nanocrew'; // {LEGAL_ENTITY}
const JURISDICTION = 'the State of California, USA'; // {JURISDICTION}
const CONTACT = 'support@nanocrew.app';

export default function Terms() {
  return (
    <main style={styles.page}>
      <div style={styles.wrap}>
        <a href="/" style={styles.back}>← Nanocrew</a>
        <h1 style={styles.h1}>Terms of Service</h1>
        <p style={styles.meta}>Effective {EFFECTIVE}</p>

        <p style={styles.p}>
          These Terms govern your use of the Nanocrew app, the storefronts it generates, and related
          services (the &ldquo;Service&rdquo;), operated by {ENTITY} (&ldquo;Nanocrew,&rdquo;
          &ldquo;we,&rdquo; &ldquo;us&rdquo;). By creating an account or using the Service you agree to
          these Terms. If you do not agree, do not use the Service.
        </p>

        <h2 style={styles.h2}>1. Eligibility &amp; accounts</h2>
        <p style={styles.p}>
          You must be at least 18 years old (or the age of majority where you live) to sell on
          Nanocrew. You are responsible for your account, for keeping your credentials secure, and for
          all activity under your account. Provide accurate information and keep it current.
        </p>

        <h2 style={styles.h2}>2. The Service</h2>
        <p style={styles.p}>
          Nanocrew lets you define a clothing brand with our AI consultant, auto-generates a
          print-on-demand shop and a storefront website, and lets you design products, publish content,
          and sell. We may add, change, or remove features at any time. Some features depend on
          third-party providers (including Stripe, Printful, Apple, and AI model providers) and are
          subject to their availability and terms.
        </p>

        <h2 style={styles.h2}>3. Your content &amp; ownership</h2>
        <p style={styles.p}>
          You retain ownership of the brand assets, designs, text, and media you create or upload
          (&ldquo;Your Content&rdquo;). You grant Nanocrew a worldwide, non-exclusive license to host,
          reproduce, display, and distribute Your Content as needed to operate the Service — for
          example, to render your storefront, generate products, fulfill orders, and promote your shop
          within Nanocrew. You represent that you have all rights necessary to Your Content and that it
          does not infringe anyone&rsquo;s rights or violate any law.
        </p>

        <h2 style={styles.h2}>4. AI-generated content</h2>
        <p style={styles.p}>
          The Service uses AI to generate designs, images, video, and voice from your inputs. AI output
          can be imperfect, unexpected, or similar to output generated for others. You are responsible
          for reviewing AI output before publishing or selling it, and for ensuring it is lawful and
          does not infringe third-party rights (including trademarks, copyrights, and likeness rights).
        </p>

        <h2 style={styles.h2}>5. Acceptable use</h2>
        <p style={styles.p}>You agree not to use the Service to:</p>
        <ul style={styles.ul}>
          <li style={styles.li}>infringe intellectual-property, privacy, or publicity rights;</li>
          <li style={styles.li}>create or sell unlawful, hateful, harassing, deceptive, or infringing products or content;</li>
          <li style={styles.li}>impersonate others or misrepresent your affiliation;</li>
          <li style={styles.li}>abuse, reverse-engineer, overload, or attempt to disrupt or gain unauthorized access to the Service;</li>
          <li style={styles.li}>use the Service to generate content that depicts real people without their consent or that violates any provider&rsquo;s policies.</li>
        </ul>
        <p style={styles.p}>We may remove content and suspend or terminate accounts that violate these Terms.</p>

        <h2 style={styles.h2}>6. Payments, credits &amp; payouts</h2>
        <ul style={styles.ul}>
          <li style={styles.li}><b>Plans &amp; credits.</b> Some features require a paid subscription or AI credits. Prices are shown in-app. In-app credit purchases on iOS are processed by Apple and are subject to Apple&rsquo;s terms; other charges are processed by Stripe.</li>
          <li style={styles.li}><b>Sales &amp; payouts.</b> When you sell a product, the customer pays through our checkout; product cost and fees are deducted and your earnings are paid out via Stripe. You are responsible for any taxes on your earnings.</li>
          <li style={styles.li}><b>Refunds.</b> Subscription and credit fees are non-refundable except where required by law or by Apple&rsquo;s policies. Customer product refunds are handled per the storefront&rsquo;s posted policy and our fulfillment partner&rsquo;s terms.</li>
        </ul>

        <h2 style={styles.h2}>7. Fulfillment</h2>
        <p style={styles.p}>
          Physical products are manufactured and shipped by our print-on-demand partner (Printful).
          Production times, shipping, and product quality are subject to their processes. You are
          responsible for setting accurate product information and for customer service on your shop.
        </p>

        <h2 style={styles.h2}>8. Third-party services &amp; Apple</h2>
        <p style={styles.p}>
          The Service integrates third-party services governed by their own terms. If you access the
          app through Apple&rsquo;s App Store, you acknowledge these Terms are between you and {ENTITY},
          not Apple; Apple is not responsible for the app or its content, and Apple is a third-party
          beneficiary entitled to enforce these Terms.
        </p>

        <h2 style={styles.h2}>9. Termination</h2>
        <p style={styles.p}>
          You may stop using the Service and delete your account at any time from Account → Delete
          account. We may suspend or terminate your access for violation of these Terms or to protect
          the Service. Provisions that by their nature should survive termination (such as ownership,
          disclaimers, and limitation of liability) will survive.
        </p>

        <h2 style={styles.h2}>10. Disclaimers</h2>
        <p style={styles.p}>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without warranties
          of any kind, whether express or implied, including merchantability, fitness for a particular
          purpose, and non-infringement. We do not warrant that the Service will be uninterrupted,
          error-free, or that AI output will meet your expectations.
        </p>

        <h2 style={styles.h2}>11. Limitation of liability</h2>
        <p style={styles.p}>
          To the maximum extent permitted by law, {ENTITY} will not be liable for any indirect,
          incidental, special, consequential, or punitive damages, or for lost profits, revenues, data,
          or goodwill. Our total liability for any claim relating to the Service will not exceed the
          greater of the amounts you paid us in the 12 months before the claim or USD $100.
        </p>

        <h2 style={styles.h2}>12. Indemnification</h2>
        <p style={styles.p}>
          You agree to indemnify and hold harmless {ENTITY} from claims, damages, and expenses arising
          out of Your Content, your products, or your violation of these Terms or applicable law.
        </p>

        <h2 style={styles.h2}>13. Governing law &amp; changes</h2>
        <p style={styles.p}>
          These Terms are governed by the laws of {JURISDICTION}, without regard to conflict-of-laws
          rules. We may update these Terms; we will revise the effective date and, for material changes,
          provide notice in the app. Continued use after changes means you accept them.
        </p>

        <h2 style={styles.h2}>14. Contact</h2>
        <p style={styles.p}>
          Questions? Email <a href={`mailto:${CONTACT}`} style={styles.a}>{CONTACT}</a>.
        </p>

        <p style={styles.foot}>
          <a href="/privacy" style={styles.a}>Privacy Policy</a> · © 2026 {ENTITY}
        </p>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { background: '#08080a', color: '#e7e9ee', minHeight: '100vh', margin: 0, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', WebkitFontSmoothing: 'antialiased' },
  wrap: { maxWidth: 720, margin: '0 auto', padding: '56px 22px 96px' },
  back: { color: '#9aa0ab', textDecoration: 'none', fontSize: 14, letterSpacing: 0.3 },
  h1: { fontSize: 34, margin: '24px 0 6px', fontWeight: 700, letterSpacing: -0.5 },
  meta: { color: '#8b909b', fontSize: 14, margin: '0 0 28px' },
  h2: { fontSize: 19, margin: '34px 0 10px', fontWeight: 650, color: '#f3f4f7' },
  p: { fontSize: 15.5, lineHeight: 1.7, color: '#c7cbd3', margin: '0 0 14px' },
  ul: { margin: '0 0 14px', paddingLeft: 20 },
  li: { fontSize: 15.5, lineHeight: 1.7, color: '#c7cbd3', margin: '0 0 9px' },
  a: { color: '#cdd1d9', textDecoration: 'underline' },
  foot: { marginTop: 44, paddingTop: 20, borderTop: '1px solid #1d1f25', color: '#8b909b', fontSize: 14 },
};
