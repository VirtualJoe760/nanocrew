// Stripe redirects here after a creator finishes payout (Connect) onboarding
// (return_url = {BILLING_RETURN_URL|PLATFORM_API_BASE}/connect/return, src/lib/connect.ts).
//
// Lives on platform-api next to billing/success, NOT on the marketing site: every Stripe-facing
// landing page sits on the one web host, which keeps the money surfaces off the app bundle and
// serves iOS, Android and web the same way.
//
// "Returned" is NOT "verified" — Stripe can still be reviewing. The app is the source of truth
// (GET /api/creator/connect re-reads charges_enabled from Stripe), so this page deliberately does
// not promise activation, it just sends them back.

export const metadata = { title: 'Payouts set up — Nano Crew' };

export default function ConnectReturn() {
  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <div style={styles.check}>✓</div>
        <h1 style={styles.h1}>Payout details submitted</h1>
        <p style={styles.p}>
          Stripe is reviewing them now. Once you&rsquo;re verified, your brand can take its own sales
          and the money lands in your account automatically.
        </p>
        <a href="nanocrew://account?payouts=return" style={styles.btn}>Return to Nano Crew</a>
        <p style={styles.fine}>Your payout status shows in the app under Account → Payouts.</p>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { background: '#08080a', color: '#e7e9ee', minHeight: '100vh', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' },
  card: { maxWidth: 420, width: '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 },
  check: { width: 64, height: 64, borderRadius: 32, border: '1.5px solid #cdd1d9', color: '#cdd1d9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, marginBottom: 6 },
  h1: { fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: -0.4 },
  p: { fontSize: 15.5, lineHeight: 1.6, color: '#c7cbd3', margin: 0 },
  btn: { marginTop: 10, background: '#cdd1d9', color: '#08080a', textDecoration: 'none', fontWeight: 700, borderRadius: 999, padding: '14px 28px', fontSize: 15 },
  fine: { fontSize: 13, color: '#8b909b', marginTop: 4 },
};
