// Stripe redirects here after a successful subscription or credit-pack checkout
// (success_url = {BILLING_RETURN_URL|API}/billing/success?plan=… or ?credits=…).
// A branded confirmation that deep-links back into the app.

export const metadata = { title: 'Payment complete — Nanocrew' };

export default async function BillingSuccess({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; credits?: string }>;
}) {
  const { plan, credits } = await searchParams;
  const headline = plan
    ? `You're on the ${plan[0].toUpperCase() + plan.slice(1)} plan`
    : credits
      ? `${Number(credits).toLocaleString()} credits added`
      : 'Payment complete';
  const sub = plan
    ? 'Your subscription is active. Head back to the app to start building.'
    : credits
      ? 'Your balance is topped up. Head back to the app to keep creating.'
      : 'Thanks — your payment went through.';

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <div style={styles.check}>✓</div>
        <h1 style={styles.h1}>{headline}</h1>
        <p style={styles.p}>{sub}</p>
        <a href="nanocrew://account?billing=success" style={styles.btn}>Return to Nanocrew</a>
        <p style={styles.fine}>You can also just close this window to go back.</p>
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
