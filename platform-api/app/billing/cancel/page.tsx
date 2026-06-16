// Stripe redirects here when a checkout is cancelled (cancel_url = {base}/billing/cancel).

export const metadata = { title: 'Checkout cancelled — Nano Crew' };

export default function BillingCancel() {
  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.h1}>Checkout cancelled</h1>
        <p style={styles.p}>No charge was made. You can pick a plan again any time from the app.</p>
        <a href="nanocrew://account" style={styles.btn}>Return to Nano Crew</a>
        <p style={styles.fine}>You can also just close this window to go back.</p>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { background: '#08080a', color: '#e7e9ee', minHeight: '100vh', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' },
  card: { maxWidth: 420, width: '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 },
  h1: { fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: -0.4 },
  p: { fontSize: 15.5, lineHeight: 1.6, color: '#c7cbd3', margin: 0 },
  btn: { marginTop: 10, background: '#cdd1d9', color: '#08080a', textDecoration: 'none', fontWeight: 700, borderRadius: 999, padding: '14px 28px', fontSize: 15 },
  fine: { fontSize: 13, color: '#8b909b', marginTop: 4 },
};
