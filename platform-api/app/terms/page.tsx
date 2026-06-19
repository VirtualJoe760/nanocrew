// Terms of Service — served at /terms (https://nanocrew-api.vercel.app/terms).
// PLACEHOLDERS to confirm before launch: {LEGAL_ENTITY}, {JURISDICTION} (governing law).
// DRAFT — not legal advice; have counsel review before launch. The §12 creator-indemnification +
// manufacturer-hold-harmless + generation-records language (added 2026-06-18) is legally material —
// review it specifically. The accepted version is recorded on creators.terms_version; keep the
// VERSION below in sync with src/lib/legal.ts TERMS_VERSION when the text materially changes.

export const metadata = {
  title: 'Terms of Service — Nano Crew',
  description: 'The terms that govern your use of Nano Crew.',
};

const EFFECTIVE = 'June 18, 2026';
const VERSION = '2026-06-18'; // keep in sync with src/lib/legal.ts TERMS_VERSION
const ENTITY = 'Nano Crew'; // {LEGAL_ENTITY}
const JURISDICTION = 'the State of California, USA'; // {JURISDICTION}
const CONTACT = 'support@nanocrew.app';

export default function Terms() {
  return (
    <main style={styles.page}>
      <div style={styles.wrap}>
        <a href="/" style={styles.back}>← Nano Crew</a>
        <h1 style={styles.h1}>Terms of Service</h1>
        <p style={styles.meta}>Effective {EFFECTIVE} · v{VERSION}</p>

        <p style={styles.p}>
          These Terms govern your use of the Nano Crew app, the storefronts it generates, and related
          services (the &ldquo;Service&rdquo;), operated by {ENTITY} (&ldquo;Nano Crew,&rdquo;
          &ldquo;we,&rdquo; &ldquo;us&rdquo;). By creating an account or using the Service you agree to
          these Terms. If you do not agree, do not use the Service.
        </p>

        <h2 style={styles.h2}>1. Eligibility &amp; accounts</h2>
        <p style={styles.p}>
          You must be at least 18 years old (or the age of majority where you live) to sell on
          Nano Crew. You are responsible for your account, for keeping your credentials secure, and for
          all activity under your account. Provide accurate information and keep it current.
        </p>

        <h2 style={styles.h2}>2. The Service</h2>
        <p style={styles.p}>
          Nano Crew lets you define a clothing brand with our AI consultant, auto-generates a
          print-on-demand shop and a storefront website, and lets you design products, publish content,
          and sell. We may add, change, or remove features at any time. Some features depend on
          third-party providers (including Stripe, Printful, Apple, and AI model providers) and are
          subject to their availability and terms.
        </p>

        <h2 style={styles.h2}>3. Your content &amp; ownership</h2>
        <p style={styles.p}>
          You retain ownership of the brand assets, designs, text, and media you create or upload
          (&ldquo;Your Content&rdquo;). You grant Nano Crew a worldwide, non-exclusive license to host,
          reproduce, display, and distribute Your Content as needed to operate the Service — for
          example, to render your storefront, generate products, fulfill orders, and promote your shop
          within Nano Crew. You represent that you have all rights necessary to Your Content and that it
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
          <li style={styles.li}>create, generate, or sell content that is unlawful where you make or sell it — and, without exception, <b>never any sexual content involving minors</b>, which we hard-block and report as required by law;</li>
          <li style={styles.li}>You own and are responsible for your designs. Mature or artistic content, including nudity, is permitted by Nano Crew, but you remain responsible for all applicable rights, age restrictions, and laws — and our AI provider, our print manufacturer, payment processors, and the app stores each enforce their own content policies and may decline to generate, print, or sell a given design. We block only pornographic content (explicit sexual acts) and high-severity graphic gore;</li>
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

        <h2 style={styles.h2}>12. Designs, indemnification &amp; generation records</h2>
        <p style={styles.p}>
          You are solely responsible for the designs, brand assets, and products you create and sell
          (&ldquo;Your Designs&rdquo;), and you represent that you own them or have all rights necessary
          to sell them. {ENTITY} is a platform and tool provider: we do not pre-screen Your Designs, do
          not claim ownership of them, and do not warrant that they are non-infringing.
        </p>
        <p style={styles.p}>
          You agree to indemnify, defend, and hold harmless {ENTITY}, its affiliates and personnel, and
          our fulfillment and manufacturing partners (including Printful) from and against any claims,
          demands, damages, liabilities, losses, and expenses (including reasonable legal fees) arising
          out of or relating to Your Designs, Your Content, your products, or your violation of these
          Terms or applicable law — including any claim that Your Designs infringe a copyright,
          trademark, patent, publicity, or other right. Any such claim is your responsibility (and,
          where applicable, the purchasing customer&rsquo;s), not {ENTITY}&rsquo;s or our manufacturers&rsquo;.
        </p>
        <p style={styles.p}>
          <b>Generation records.</b> For designs made with our AI tools, we retain generation metadata —
          including the prompts you provided and the time of creation — as a record of how and when a
          design was made. We may use these records to respond to disputes or rights claims. They are a
          record only and are not a warranty that any design is original or non-infringing.
        </p>
        <p style={styles.p}>
          By creating an account you accept these Terms, and we record which version you accepted and
          when.
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
