'use client';

import { useState } from 'react';

import { authConfigured, supabase } from '@/lib/supabase';

// Creating an account IS the waitlist (Joe, 2026-08-16): it holds your place in line and it's how
// the next round of TestFlight testers gets picked. No new backend — this uses the Supabase auth
// the site already gained for invites, plus the existing /api/waitlist table so the email still
// lands where the waitlist has always lived.

const TERMS_VERSION = '2026-06-18'; // mirrors src/lib/legal.ts

export function BetaSignup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'in' | 'confirm' | null>(null);

  /** Best-effort: keep the waitlist table populated as it always has been. Never blocks signup. */
  async function recordOnWaitlist(addr: string) {
    try {
      await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: addr }),
      });
    } catch {
      /* the account is what matters; the table is a convenience */
    }
  }

  function oauth(provider: 'google' | 'apple') {
    setError(null);
    if (!authConfigured) return setError('Sign-up is temporarily unavailable. Try again shortly.');
    void supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/?welcome=1` },
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!authConfigured) throw new Error('Sign-up is temporarily unavailable. Try again shortly.');
      const addr = email.trim().toLowerCase();
      const { data, error: e2 } = await supabase.auth.signUp({
        email: addr,
        password,
        options: { data: { terms_version: TERMS_VERSION, source: 'web_beta' } },
      });
      if (e2) throw e2;
      await recordOnWaitlist(addr);
      setDone(data.session ? 'in' : 'confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account — try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="signup">
        <p className="ok">{done === 'in' ? "✦ You're on the list." : '✦ Check your email.'}</p>
        <p className="fine">
          {done === 'in'
            ? "Your place is held against this email. We'll write when your TestFlight invite is ready."
            : `We sent a confirmation link to ${email}. Confirm it and your place is locked in.`}
        </p>
      </div>
    );
  }

  return (
    <form className="signup" onSubmit={submit}>
      <button className="oauth" type="button" onClick={() => oauth('google')} disabled={busy}>
        Continue with Google
      </button>
      <button className="oauth" type="button" onClick={() => oauth('apple')} disabled={busy}>
        Continue with Apple
      </button>
      <div className="or">
        <span />
        <em>or</em>
        <span />
      </div>
      <input
        className="field"
        type="email"
        placeholder="Email"
        autoComplete="email"
        required
        value={email}
        onChange={(ev) => setEmail(ev.target.value)}
      />
      <input
        className="field"
        type="password"
        placeholder="Create a password"
        autoComplete="new-password"
        required
        minLength={8}
        value={password}
        onChange={(ev) => setPassword(ev.target.value)}
      />
      <button className="btn" type="submit" style={{ width: '100%', marginTop: 4 }} disabled={busy}>
        {busy ? 'One moment…' : 'Create account'}
      </button>
      {error ? <p className="err">{error}</p> : null}
      <p className="fine">
        By creating an account you agree to the{' '}
        <a href="/terms" style={{ color: 'var(--accent)' }}>
          Terms &amp; Creator Agreement
        </a>
        .
      </p>
    </form>
  );
}
