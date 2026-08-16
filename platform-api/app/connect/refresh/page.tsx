// Stripe redirects here when a Connect account link EXPIRES or is reused
// (refresh_url = {BILLING_RETURN_URL|PLATFORM_API_BASE}/connect/refresh, src/lib/connect.ts).
//
// Account links are single-use and short-lived, so this is a normal path, not an error — the
// creator opened a stale link. We can't mint a new one here (that needs their authed session), so
// send them back to the app, where tapping Payouts again calls POST /api/creator/connect for a
// fresh link.

export const metadata = { title: 'Payout link expired — Nano Crew' };

export default function ConnectRefresh() {
  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <div style={styles.mark}>↻</div>
        <h1 style={styles.h1}>That link expired</h1>
        <p style={styles.p}>
          Payout links are single-use and time out for security. Nothing is wrong with your account —
          open payouts again in the app and Stripe will pick up right where you left off.
        </p>
        <a href="nanocrew://account?payouts=refresh" style={styles.btn}>Return to Nano Crew</a>
        <p style={styles.fine}>Account → Payouts.</p>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { background: '#08080a', color: '#e7e9ee', minHeight: '100vh', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' },
  card: { maxWidth: 420, width: '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 },
  mark: { width: 64, height: 64, borderRadius: 32, border: '1.5px solid #8b909b', color: '#c7cbd3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, marginBottom: 6 },
  h1: { fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: -0.4 },
  p: { fontSize: 15.5, lineHeight: 1.6, color: '#c7cbd3', margin: 0 },
  btn: { marginTop: 10, background: '#cdd1d9', color: '#08080a', textDecoration: 'none', fontWeight: 700, borderRadius: 999, padding: '14px 28px', fontSize: 15 },
  fine: { fontSize: 13, color: '#8b909b', marginTop: 4 },
};
