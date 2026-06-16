// Privacy Policy — served at /privacy (https://nanocrew-api.vercel.app/privacy).
// Grounded in Nano Crew's real data flows. PLACEHOLDERS to confirm before launch:
//   {LEGAL_ENTITY}  = the legal business name (e.g. "Nano Crew, Inc." or sole-proprietor name)
//   {JURISDICTION}  = governing-law state/country
//   contact email is set to support@ — change if you use a different address.
// This is a solid, app-specific draft, not legal advice — have counsel review before launch.

export const metadata = {
  title: 'Privacy Policy — Nano Crew',
  description: 'How Nano Crew collects, uses, and protects your information.',
};

const EFFECTIVE = 'June 14, 2026';
const ENTITY = 'Nano Crew'; // {LEGAL_ENTITY}
const CONTACT = 'support@nanocrew.app';

export default function PrivacyPolicy() {
  return (
    <main style={styles.page}>
      <div style={styles.wrap}>
        <a href="/" style={styles.back}>← Nano Crew</a>
        <h1 style={styles.h1}>Privacy Policy</h1>
        <p style={styles.meta}>Effective {EFFECTIVE}</p>

        <p style={styles.p}>
          {ENTITY} (&ldquo;Nano Crew,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) operates the Nano Crew mobile
          app and the storefront websites it generates for creators. This policy explains what we
          collect, why, who we share it with, and the choices you have. By using Nano Crew you agree
          to this policy.
        </p>

        <h2 style={styles.h2}>1. Information we collect</h2>
        <ul style={styles.ul}>
          <li style={styles.li}>
            <b>Account &amp; identity.</b> When you sign up we collect your email address and
            authentication identifiers. Sign-in is handled by our auth provider (Supabase) and, if you
            choose, by Apple, Google, or Facebook. We never see or store your password for those
            services.
          </li>
          <li style={styles.li}>
            <b>Creator content.</b> The brand details, product designs, text, and media you create or
            upload (hosted via Cloudinary), plus the conversations you have with our AI consultant
            &ldquo;Venus&rdquo; to define your brand.
          </li>
          <li style={styles.li}>
            <b>Try-on photos.</b> If you use virtual try-on, the selfie you provide is sent for
            processing to generate a try-on image. <b>The selfie itself is not stored</b> — only the
            generated try-on render is hosted so you can view and share it.
          </li>
          <li style={styles.li}>
            <b>Payments.</b> Purchases and creator payouts are processed by Stripe, and in-app credit
            purchases on iOS by Apple. We receive confirmation and limited transaction details (such as
            amount and status) but <b>never your full card number</b>.
          </li>
          <li style={styles.li}>
            <b>Orders &amp; fulfillment.</b> When a product sells, the shipping name, address, and order
            details needed to fulfill it are shared with our print-on-demand partner (Printful).
          </li>
          <li style={styles.li}>
            <b>AI generation inputs.</b> Prompts, reference images, and design inputs you submit are
            processed by our AI model providers to generate designs, images, video, and voice.
          </li>
          <li style={styles.li}>
            <b>Device &amp; usage.</b> A push-notification token (if you enable notifications), and basic
            app/usage and diagnostic data to operate, secure, and improve the service.
          </li>
        </ul>

        <h2 style={styles.h2}>2. How we use information</h2>
        <ul style={styles.ul}>
          <li style={styles.li}>To provide the service: create your shop and storefront, generate designs and media, process sales, and pay out earnings.</li>
          <li style={styles.li}>To process payments, fulfill orders, and prevent fraud and abuse.</li>
          <li style={styles.li}>To send you transactional and, if enabled, push notifications.</li>
          <li style={styles.li}>To secure, debug, analyze, and improve Nano Crew.</li>
          <li style={styles.li}>To comply with legal obligations and enforce our terms.</li>
        </ul>

        <h2 style={styles.h2}>3. Service providers we share with</h2>
        <p style={styles.p}>
          We share data only as needed to run Nano Crew, with providers acting on our behalf:
        </p>
        <ul style={styles.ul}>
          <li style={styles.li}><b>Supabase</b> — authentication and database hosting.</li>
          <li style={styles.li}><b>Stripe</b> — payment processing and creator payouts.</li>
          <li style={styles.li}><b>Apple</b> — in-app purchases and Sign in with Apple.</li>
          <li style={styles.li}><b>Printful</b> — product manufacturing and shipping.</li>
          <li style={styles.li}><b>Cloudinary</b> — image, video, and audio hosting.</li>
          <li style={styles.li}><b>AI model providers</b> — generating designs, images, video, and voice from your inputs.</li>
          <li style={styles.li}><b>Vercel &amp; Railway</b> — application and API hosting.</li>
        </ul>
        <p style={styles.p}>
          We do <b>not</b> sell your personal information. We may disclose information if required by
          law or to protect the rights, safety, and security of our users and the service.
        </p>

        <h2 style={styles.h2}>4. Data retention &amp; deletion</h2>
        <p style={styles.p}>
          We keep your information for as long as your account is active or as needed to provide the
          service and meet legal, accounting, or reporting requirements. You can delete your account
          at any time from <b>Account → Delete account</b> in the app. Deletion removes your creator
          profile and associated data, cancels associated content, and deletes your authentication
          identity. Some records (such as transaction records required for tax and legal compliance)
          may be retained as required by law.
        </p>

        <h2 style={styles.h2}>5. Your rights &amp; choices</h2>
        <p style={styles.p}>
          Depending on where you live, you may have the right to access, correct, export, or delete
          your personal information, and to object to or restrict certain processing. You can exercise
          most of these in-app, or contact us at <a href={`mailto:${CONTACT}`} style={styles.a}>{CONTACT}</a>.
          You can turn push notifications off at any time in your device settings.
        </p>

        <h2 style={styles.h2}>6. Children</h2>
        <p style={styles.p}>
          Nano Crew is not directed to children under 13 (or the minimum age in your country), and we
          do not knowingly collect their personal information. If you believe a child has provided us
          information, contact us and we will delete it.
        </p>

        <h2 style={styles.h2}>7. International users</h2>
        <p style={styles.p}>
          We operate in the United States and our providers may process data there and elsewhere. By
          using Nano Crew you understand your information may be transferred to and processed in
          countries with different data-protection laws than your own.
        </p>

        <h2 style={styles.h2}>8. Security</h2>
        <p style={styles.p}>
          We use industry-standard measures (encryption in transit, scoped access, reputable
          providers) to protect your information. No method of transmission or storage is perfectly
          secure, so we cannot guarantee absolute security.
        </p>

        <h2 style={styles.h2}>9. Changes</h2>
        <p style={styles.p}>
          We may update this policy from time to time. We will revise the effective date above and,
          for material changes, provide notice in the app.
        </p>

        <h2 style={styles.h2}>10. Contact</h2>
        <p style={styles.p}>
          Questions? Email us at <a href={`mailto:${CONTACT}`} style={styles.a}>{CONTACT}</a>.
        </p>

        <p style={styles.foot}>
          <a href="/terms" style={styles.a}>Terms of Service</a> · © 2026 {ENTITY}
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
