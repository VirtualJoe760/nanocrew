'use client';

import { useCallback, useEffect, useState } from 'react';

import { apiFetch } from '@/lib/api';

import { Brands } from './brands';
import { authConfigured, supabase } from '@/lib/supabase';

// The signed-in account surface. Reads and writes through platform-api
// (GET/PATCH /api/creator/account) with the site's Supabase bearer — the site holds no database
// credential, same contract the app has with its own backend.
//
// The identity header is read-only and matches the app exactly (avatar, email, plan badge,
// creator id). What the app does NOT let you change — your name and phone, captured once at
// sign-up — is editable here. Email is shown but fixed: it's the key collaboration invites and
// customer order-lookups match on, so changing it would quietly cost people access.

const PLAN_LABEL: Record<string, string> = { free: 'Free', starter: 'Starter', pro: 'Pro', advanced: 'Advanced' };

type Profile = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  image: string | null;
  createdAt: string;
};

export function AccountPanel() {
  const [state, setState] = useState<'loading' | 'anon' | 'ready'>('loading');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [plan, setPlan] = useState('free');
  const [avatar, setAvatar] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pw, setPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwNote, setPwNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!authConfigured) return setState('anon');
    const { data } = await supabase.auth.getSession();
    if (!data.session) return setState('anon');
    // OAuth accounts carry a picture in their metadata; the app reads the same fields.
    const meta = data.session.user.user_metadata as { avatar_url?: string; picture?: string } | undefined;
    setAvatar(meta?.avatar_url ?? meta?.picture ?? null);

    const res = await apiFetch('/api/creator/account');
    if (!res.ok) {
      setError(res.status === 401 ? 'Your session expired — sign in again.' : 'Could not load your account.');
      setState(res.status === 401 ? 'anon' : 'ready');
      return;
    }
    const body = (await res.json()) as { profile: Profile; plan: string };
    setProfile(body.profile);
    setPlan(body.plan);
    setName(body.profile.name ?? '');
    setPhone(body.profile.phone ?? '');
    setState('ready');
  }, []);

  useEffect(() => {
    void load();
    const { data: sub } = supabase.auth.onAuthStateChange(() => void load());
    return () => sub.subscription.unsubscribe();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await apiFetch('/api/creator/account', {
        method: 'PATCH',
        body: JSON.stringify({ name, phone }),
      });
      const body = (await res.json().catch(() => ({}))) as { profile?: Profile; error?: string };
      if (!res.ok || !body.profile) throw new Error(body.error ?? 'Could not save your changes.');
      setProfile(body.profile);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your changes.');
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwBusy(true);
    setPwNote(null);
    try {
      const { error: e2 } = await supabase.auth.updateUser({ password: pw });
      if (e2) throw e2;
      setPw('');
      setPwNote('Password updated.');
    } catch (err) {
      setPwNote(err instanceof Error ? err.message : 'Could not update your password.');
    } finally {
      setPwBusy(false);
    }
  }

  if (state === 'loading') return <p className="acct-muted">Loading your account…</p>;

  if (state === 'anon') {
    return (
      <div className="acct-card acct-signedout">
        <h1>You&rsquo;re signed out.</h1>
        <p className="acct-muted">Sign in to edit your account details.</p>
        <a className="btn" href="/?login=1#beta">
          Log in
        </a>
      </div>
    );
  }

  const initial = (profile?.email?.[0] ?? '?').toUpperCase();
  const dirty = (profile?.name ?? '') !== name || (profile?.phone ?? '') !== phone;

  return (
    <>
      {/* Identity header — read-only, same as the app's profile block. */}
      <div className="acct-head">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="acct-avatar" src={avatar} alt="" />
        ) : (
          <div className="acct-avatar acct-avatar-fallback">{initial}</div>
        )}
        <div className="acct-id">
          <span className="acct-email">{profile?.email}</span>
          <span className="acct-meta">
            <span className="acct-plan">{(PLAN_LABEL[plan] ?? plan).toUpperCase()}</span>
            <span className="acct-code">creator {profile?.id.slice(0, 8)}</span>
          </span>
        </div>
      </div>

      <p className="acct-label">Your details</p>
      <form className="acct-card" onSubmit={save}>
        <label className="acct-field">
          <span>Name</span>
          <input
            className="field"
            value={name}
            maxLength={80}
            placeholder="Your name"
            onChange={(e) => { setName(e.target.value); setSaved(false); }}
          />
        </label>
        <label className="acct-field">
          <span>Phone</span>
          <input
            className="field"
            value={phone}
            type="tel"
            placeholder="Optional"
            onChange={(e) => { setPhone(e.target.value); setSaved(false); }}
          />
        </label>
        <label className="acct-field">
          <span>Email</span>
          <input className="field" value={profile?.email ?? ''} readOnly disabled />
          <em className="acct-hint">
            Your email identifies you across Nano Crew — brand invitations and order lookups match on
            it, so it can&rsquo;t be changed here. Contact us if you need it moved.
          </em>
        </label>
        <div className="acct-actions">
          <button className="btn" type="submit" disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {saved ? <span className="acct-ok">✦ Saved</span> : null}
          {error ? <span className="acct-err">{error}</span> : null}
        </div>
      </form>

      <Brands />

      <p className="acct-label">Password</p>
      <form className="acct-card" onSubmit={changePassword}>
        <label className="acct-field">
          <span>New password</span>
          <input
            className="field"
            type="password"
            value={pw}
            minLength={8}
            required
            autoComplete="new-password"
            placeholder="At least 8 characters"
            onChange={(e) => { setPw(e.target.value); setPwNote(null); }}
          />
        </label>
        <div className="acct-actions">
          <button className="btn ghost" type="submit" disabled={pw.length < 8 || pwBusy}>
            {pwBusy ? 'Updating…' : 'Update password'}
          </button>
          {pwNote ? (
            <span className={pwNote === 'Password updated.' ? 'acct-ok' : 'acct-err'}>{pwNote}</span>
          ) : null}
        </div>
      </form>

      <div className="acct-foot">
        <button className="btn ghost" type="button" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </button>
        <span className="acct-hint">
          Deleting your account is done in the app, under Account.
        </span>
      </div>
    </>
  );
}
