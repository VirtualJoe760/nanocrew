'use client';

import { useEffect, useRef, useState } from 'react';

import { apiFetch } from '@/lib/api';
import { supabase } from '@/lib/supabase';

// The DESKTOP half of the invite page: a laptop can't open nanocrew://, so the invitee signs in —
// or creates their account — here, and the acceptance is written on the web.
//
// Auth uses supabase-js exactly as the app does, and the accept goes through apiFetch(), which
// attaches the bearer and calls platform-api. Nothing here talks to a database; the server enforces
// everything that matters (email match, expiry, pending-only). This form only produces a session.

const TERMS_VERSION = '2026-06-18'; // mirrors src/lib/legal.ts

export function WebAccept({
  token,
  emailHint,
  storeName,
}: {
  token: string;
  /** Masked (j•••@gmail.com) — the API never hands the full address to an unauthenticated caller. */
  emailHint: string;
  storeName: string;
}) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'accepted' | 'confirm_email' | null>(null);

  async function accept() {
    const res = await apiFetch('/api/public/invite', {
      method: 'POST',
      body: JSON.stringify({ token, action: 'accept' }),
    });
    const body = (await res.json().catch(() => ({}))) as { accepted?: boolean; error?: string };
    if (!res.ok || !body.accepted) throw new Error(body.error ?? 'Could not accept the invitation.');
    setDone('accepted');
  }

  // OAuth return: supabase-js (detectSessionInUrl) consumes the tokens from the hash and clears
  // them, so by the time a session exists the URL is already clean. Finish the accept immediately.
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return; // ordinary first visit — show the form
      setBusy(true);
      try {
        await accept();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong — try again.');
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function oauth(provider: 'google' | 'facebook') {
    // Come back to this exact page; the token rides the path, so there's nothing else to carry.
    void supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        const { error: e } = await supabase.auth.signInWithPassword({ email, password });
        if (e) throw e;
      } else {
        const { data, error: e } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name, full_name: name, terms_version: TERMS_VERSION } },
        });
        if (e) throw e;
        if (!data.session) {
          // Email confirmation is on: the account exists but there's no session yet.
          setDone('confirm_email');
          return;
        }
      }
      await accept();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong — try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done === 'accepted') {
    return (
      <div className="eve-form">
        <p className="eve-success">✓ You&rsquo;re on {storeName} now.</p>
        <p className="eve-fine">
          Open the Nano Crew app on your phone to start designing — the brand is already in your Account.
        </p>
      </div>
    );
  }
  if (done === 'confirm_email') {
    return (
      <div className="eve-form">
        <p className="eve-success">Almost there — confirm your email.</p>
        <p className="eve-fine">
          We sent a confirmation link to {email}. Confirm it, then open this invitation link again to
          finish joining {storeName}.
        </p>
      </div>
    );
  }

  const canSubmit = !!email.trim() && !!password && !busy && (mode === 'login' || (agreed && !!name.trim()));

  return (
    <div className="eve-form">
      <button className="eve-oauth" onClick={() => oauth('google')} type="button" disabled={busy}>
        Continue with Google
      </button>
      <button className="eve-oauth" onClick={() => oauth('facebook')} type="button" disabled={busy}>
        Continue with Facebook
      </button>
      <div className="eve-divider">
        <span />
        <em>or use email</em>
        <span />
      </div>

      <div className="eve-tabs">
        <button className="eve-tab" data-on={mode === 'login'} onClick={() => setMode('login')} type="button">
          Sign in
        </button>
        <button className="eve-tab" data-on={mode === 'signup'} onClick={() => setMode('signup')} type="button">
          Create account
        </button>
      </div>

      {mode === 'signup' ? (
        <input className="eve-input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      ) : null}
      <input
        className="eve-input"
        placeholder="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
      />
      <input
        className="eve-input"
        placeholder="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
      />
      {mode === 'signup' ? (
        <label className="eve-terms">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            I agree to the{' '}
            <a href="/terms" target="_blank" rel="noreferrer">
              Terms &amp; Creator Agreement
            </a>
          </span>
        </label>
      ) : null}

      <button className="eve-cta" disabled={!canSubmit} onClick={() => void submit()} type="button">
        {busy ? 'One moment…' : mode === 'login' ? 'Sign in & accept' : 'Create account & accept'}
      </button>
      {error ? <p className="eve-error">{error}</p> : null}
      <p className="eve-fine">This invitation was sent to {emailHint} — use that address.</p>
    </div>
  );
}
