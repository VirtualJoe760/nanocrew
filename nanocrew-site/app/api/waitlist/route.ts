import { API_BASE } from '@/lib/api';

// API_BASE is '' in production — NEXT_PUBLIC_API_BASE is set to an empty string, and `??` only
// falls back on undefined. Client-side that just means same-origin relative URLs; here on the
// server a relative URL has no host and fetch throws, which is a 502 on every signup. Resolve an
// ABSOLUTE base explicitly rather than changing what API_BASE means for the whole site.
const PLATFORM_API =
  (process.env.PLATFORM_API_BASE || '').replace(/\/+$/, '') ||
  (API_BASE.startsWith('http') ? API_BASE : '') ||
  'https://platform.nanocrew.app';

export const runtime = 'nodejs';

// BETA SIGNUP — this route is a THIN PROXY to platform-api, on purpose.
//
// It used to own the signup itself: `create table if not exists waitlist` against DATABASE_URL. But
// nanocrew-site holds no database credential (AGENTS.md), so that env var was never set here, the
// table was never created, and every signup fell through the `if (!conn)` branch to a console.log
// on a Vercel function — no row, no email, no beta invite. That is exactly what happened to the
// person who signed up on 2026-08-18 (Joe: "i didnt recieve an email about it. nor did they get
// added to the beta").
//
// The real thing lives at platform-api `/api/public/beta-signup`, which has the database, the
// mailer and the App Store Connect key: it caps the beta, adds iOS testers to TestFlight, waitlists
// the overflow, and emails both the signer and ops. We keep this path so the form's URL doesn't
// change, and proxy server-side so the browser never needs CORS.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  let email = '';
  let platform = 'ios';
  try {
    const b = (await req.json()) as { email?: string; platform?: string };
    email = (b.email || '').trim().toLowerCase();
    platform = b.platform === 'android' ? 'android' : 'ios';
  } catch {
    return Response.json({ ok: false, error: 'Bad request' }, { status: 400 });
  }
  if (!EMAIL_RE.test(email) || email.length > 320) {
    return Response.json({ ok: false, error: 'Enter a valid email.' }, { status: 400 });
  }

  try {
    const res = await fetch(`${PLATFORM_API}/api/public/beta-signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, platform, source: 'nanocrew.app' }),
      cache: 'no-store',
    });
    const d = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: string; error?: string };
    if (!res.ok || !d.ok) {
      return Response.json({ ok: false, error: d.error || 'Could not save — try again.' }, { status: res.status || 500 });
    }
    return Response.json({ ok: true, status: d.status ?? 'waitlisted' });
  } catch (e) {
    console.error('[waitlist proxy]', e instanceof Error ? e.message : e);
    return Response.json({ ok: false, error: 'Could not save — try again.' }, { status: 502 });
  }
}
