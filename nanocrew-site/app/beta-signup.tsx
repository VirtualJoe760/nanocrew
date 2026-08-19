'use client';

import { useEffect, useState } from 'react';

import { authConfigured, supabase } from '@/lib/supabase';

// Creating an account IS the waitlist (Joe, 2026-08-16): it holds your place in line and it's how
// the next round of TestFlight testers gets picked. No new backend — this uses the Supabase auth
// the site already gained for invites, plus the existing /api/waitlist table so the email still
// lands where the waitlist has always lived.

const TERMS_VERSION = '2026-06-18'; // mirrors src/lib/legal.ts

// The beta is a finite number of build slots per store, so signing up has to say WHICH build. An
// iPhone signup goes to TestFlight; Android is its own queue. Without this the backend has to guess,
// and a guess costs somebody a slot on a platform they can't install.
const PLATFORMS = [
  { id: 'ios', label: 'iPhone' },
  { id: 'android', label: 'Android' },
] as const;
type Platform = (typeof PLATFORMS)[number]['id'];

export function BetaSignup() {
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'in' | 'confirm' | null>(null);
  const [platform, setPlatform] = useState<Platform>('ios');
  const [slot, setSlot] = useState<'approved' | 'waitlisted' | null>(null);

  // Coming back from the Google/Apple round-trip lands here with a session already established —
  // without this the form would just re-render empty and the whole trip would look like it failed.
  useEffect(() => {
    // Arriving from the hero's "Log in" (/?login=1#beta) should land on the login form, not the
    // signup one. Read from location rather than useSearchParams so the homepage stays static.
    const params = new URLSearchParams(window.location.search);
    if (params.get('login') === '1') setMode('login');
    const back = params.get('platform');
    if (back === 'android' || back === 'ios') setPlatform(back);
    if (!authConfigured) return;
    void supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return;
      setDone('in');
      // Coming back from OAuth with a session and a platform in the URL: this IS the signup, so
      // claim the slot now — it never happened on the provider's side of the trip.
      const addr = data.session.user.email;
      if (back && addr) {
        void fetch('/api/waitlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: addr, platform: back }),
        })
          .then((r) => r.json())
          .then((d: { status?: string }) => {
            if (d?.status === 'approved' || d?.status === 'waitlisted') setSlot(d.status);
          })
          .catch(() => {});
      }
    });
  }, []);

  /** Claim a beta slot. Never blocks the account — but its ANSWER decides what we promise them:
   *  a slot means TestFlight is already on its way, no slot means we write at launch. */
  async function recordOnWaitlist(addr: string) {
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: addr, platform }),
      });
      const d = (await res.json().catch(() => ({}))) as { status?: string };
      if (d.status === 'approved' || d.status === 'waitlisted') setSlot(d.status);
    } catch {
      /* the account is what matters; the slot request can be retried */
    }
  }

  function oauth(provider: 'google' | 'apple') {
    setError(null);
    if (!authConfigured) return setError('Sign-up is temporarily unavailable. Try again shortly.');
    // The Google/Apple round trip leaves the page, so the claim can't be made here — carry the
    // platform in the return URL and claim it on the way back (the effect above). Without this,
    // every OAuth signup created an account and asked for NO beta slot at all.
    void supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/?welcome=1&platform=${platform}` },
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!authConfigured) throw new Error('Sign-up is temporarily unavailable. Try again shortly.');
      const addr = email.trim().toLowerCase();

      if (mode === 'login') {
        const { error: e1 } = await supabase.auth.signInWithPassword({ email: addr, password });
        if (e1) throw e1;
        setDone('in');
        return;
      }

      const { data, error: e2 } = await supabase.auth.signUp({
        email: addr,
        password,
        options: { data: { terms_version: TERMS_VERSION, source: 'web_beta' } },
      });
      if (e2) throw e2;
      await recordOnWaitlist(addr);
      setDone(data.session ? 'in' : 'confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong — try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="signup">
        <p className="ok">{done === 'in' ? "✦ You're on the list." : '✦ Check your email.'}</p>
        <p className="fine">
          {done === 'confirm'
            ? `We sent a confirmation link to ${email}. Confirm it and your place is locked in.`
            : slot === 'approved'
              ? platform === 'ios'
                ? "You're in — check your email for the TestFlight invite."
                : "You're in — we'll email you the Play beta link shortly."
              : slot === 'waitlisted'
                ? "The beta is full right now, so we've saved your place — we'll email you the moment it opens up."
                : "Your place is held against this email. We'll write when your invite is ready."}
        </p>
        {done === 'in' ? (
          <a className="btn ghost" href="/account" style={{ textAlign: 'center', marginTop: 4 }}>
            Your account
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <form className="signup" onSubmit={submit}>
      <div className="plat" role="group" aria-label="Which phone do you have?">
        {PLATFORMS.map((pl) => (
          <button
            key={pl.id}
            type="button"
            className={`plat-btn${platform === pl.id ? ' on' : ''}`}
            aria-pressed={platform === pl.id}
            onClick={() => setPlatform(pl.id)}
            disabled={busy}>
            {pl.label}
          </button>
        ))}
      </div>
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
        placeholder={mode === 'signup' ? 'Create a password' : 'Password'}
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        required
        minLength={mode === 'signup' ? 8 : undefined}
        value={password}
        onChange={(ev) => setPassword(ev.target.value)}
      />
      <button className="btn" type="submit" style={{ width: '100%', marginTop: 4 }} disabled={busy}>
        {busy ? 'One moment…' : mode === 'signup' ? 'Create account' : 'Log in'}
      </button>

      {/* Small switch under the button — without it, anyone who already signed up hits
          "User already registered" and has nowhere to go. */}
      <p className="switch">
        {mode === 'signup' ? 'Already have an account? ' : 'New here? '}
        <button
          type="button"
          onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError(null); }}>
          {mode === 'signup' ? 'Log in' : 'Create one'}
        </button>
      </p>

      {error ? <p className="err">{error}</p> : null}
      {mode === 'signup' ? (
        <p className="fine">
          By creating an account you agree to the{' '}
          <a href="/terms" style={{ color: 'var(--accent)' }}>
            Terms &amp; Creator Agreement
          </a>
          .
        </p>
      ) : null}
    </form>
  );
}
