'use client';

import { useState } from 'react';

// The DESKTOP half of the invite landing page (Joe, 2026-08-16): a laptop can't open nanocrew://,
// so instead of a dead deep-link button the invitee signs in — or creates their account — right
// here, and the acceptance is written through POST /api/public/invite with their Supabase bearer.
//
// Auth talks to Supabase's REST API directly from the browser with the PUBLISHABLE key (the same
// key the app bundle ships — public by design; RLS is deny-all so it reads nothing). No SDK, no
// session persisted: the token lives in memory just long enough to accept.
//
// The server still enforces everything that matters — email match, expiry, pending-only — this
// form is only a way to get a bearer.

export function WebAccept({
  token,
  invitedEmail,
  storeName,
  supabaseUrl,
  supabaseKey,
}: {
  token: string;
  /** Shown as a hint — the server rejects any other account with 403 email_mismatch. */
  invitedEmail: string;
  storeName: string;
  supabaseUrl: string;
  supabaseKey: string;
}) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState(invitedEmail);
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'accepted' | 'confirm_email' | null>(null);

  async function authAndAccept() {
    setBusy(true);
    setError(null);
    try {
      // 1. A bearer, via Supabase REST. Signup carries the same user_metadata shape the app's
      //    email form writes (name + terms), so /api/me's backfill sees a familiar row later.
      const authRes = await fetch(
        mode === 'login'
          ? `${supabaseUrl}/auth/v1/token?grant_type=password`
          : `${supabaseUrl}/auth/v1/signup`,
        {
          method: 'POST',
          headers: { apikey: supabaseKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(
            mode === 'login'
              ? { email, password }
              : { email, password, data: { name, full_name: name, terms_version: '2026-06-18' } },
          ),
        },
      );
      const auth = (await authRes.json()) as {
        access_token?: string;
        error_description?: string;
        msg?: string;
        error?: { message?: string } | string;
      };
      if (!authRes.ok) {
        const msg =
          auth.error_description ?? auth.msg ?? (typeof auth.error === 'string' ? auth.error : auth.error?.message);
        throw new Error(msg ?? (mode === 'login' ? 'Could not sign in.' : 'Could not create the account.'));
      }
      if (!auth.access_token) {
        // Email confirmation is on: the account exists but there's no session until they confirm.
        setDone('confirm_email');
        return;
      }

      // 2. The acceptance itself — server-verified (email match, expiry, pending-only).
      const acceptRes = await fetch('/api/public/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.access_token}` },
        body: JSON.stringify({ token, action: 'accept' }),
      });
      const accept = (await acceptRes.json()) as { accepted?: boolean; error?: string };
      if (!acceptRes.ok || !accept.accepted) throw new Error(accept.error ?? 'Could not accept the invitation.');
      setDone('accepted');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong — try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done === 'accepted') {
    return (
      <div style={s.wrap}>
        <p style={s.success}>✓ You&rsquo;re on {storeName} now.</p>
        <p style={s.fine}>
          Open the Nano Crew app on your phone to start designing — the brand is already in your
          Account.
        </p>
      </div>
    );
  }
  if (done === 'confirm_email') {
    return (
      <div style={s.wrap}>
        <p style={s.success}>Almost there — confirm your email.</p>
        <p style={s.fine}>
          We sent a confirmation link to {email}. Confirm, then open this invitation link again to
          finish joining {storeName}.
        </p>
      </div>
    );
  }

  const canSubmit = email.trim() && password && !busy && (mode === 'login' || (agreed && name.trim()));

  return (
    <div style={s.wrap}>
      <div style={s.tabs}>
        <button style={{ ...s.tab, ...(mode === 'login' ? s.tabOn : {}) }} onClick={() => setMode('login')} type="button">
          Sign in
        </button>
        <button style={{ ...s.tab, ...(mode === 'signup' ? s.tabOn : {}) }} onClick={() => setMode('signup')} type="button">
          Create account
        </button>
      </div>

      {mode === 'signup' ? (
        <input style={s.input} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      ) : null}
      <input
        style={s.input}
        placeholder="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
      />
      <input
        style={s.input}
        placeholder="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
      />
      {mode === 'signup' ? (
        <label style={s.terms}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            I agree to the{' '}
            <a href="/terms" target="_blank" rel="noreferrer" style={s.link}>
              Terms &amp; Creator Agreement
            </a>
          </span>
        </label>
      ) : null}

      <button style={{ ...s.btn, opacity: canSubmit ? 1 : 0.5 }} disabled={!canSubmit} onClick={() => void authAndAccept()} type="button">
        {busy ? 'One moment…' : `Accept as ${email.trim() || 'this account'}`}
      </button>
      {error ? <p style={s.error}>{error}</p> : null}
      <p style={s.fine}>This invitation was sent to {invitedEmail} — sign in with that address.</p>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 340, marginTop: 8 },
  tabs: { display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 4 },
  tab: { background: 'transparent', color: '#8b909b', border: '1px solid #2a2d34', borderRadius: 999, padding: '7px 18px', fontSize: 13, cursor: 'pointer' },
  tabOn: { color: '#08080a', background: '#cdd1d9', borderColor: '#cdd1d9', fontWeight: 700 },
  input: { background: '#101318', border: '1px solid #2a2d34', borderRadius: 10, color: '#e7e9ee', padding: '12px 14px', fontSize: 15, outline: 'none' },
  terms: { display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: '#c7cbd3', textAlign: 'left' },
  link: { color: '#cdd1d9' },
  btn: { background: '#cdd1d9', color: '#08080a', border: 'none', fontWeight: 700, borderRadius: 999, padding: '13px 26px', fontSize: 15, cursor: 'pointer', marginTop: 4 },
  error: { color: '#ff8a8a', fontSize: 13.5, margin: 0 },
  success: { color: '#9be8c5', fontSize: 17, fontWeight: 600, margin: 0, textAlign: 'center' },
  fine: { fontSize: 13, color: '#8b909b', margin: 0, textAlign: 'center', lineHeight: 1.55 },
};
