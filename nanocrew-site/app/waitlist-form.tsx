'use client';

import { useState } from 'react';

// The beta has a finite number of build slots, so the form has to ask WHICH build — an iPhone
// signup and an Android signup are different queues with different caps. The answer decides which
// list they land on, so it's a first-class question, not a preference.
const PLATFORMS = [
  { id: 'ios', label: 'iPhone' },
  { id: 'android', label: 'Android' },
] as const;

type Platform = (typeof PLATFORMS)[number]['id'];

export function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [platform, setPlatform] = useState<Platform>('ios');
  const [state, setState] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle');
  const [msg, setMsg] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setState('sending');
    setMsg('');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), platform }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: string; error?: string };
      if (!res.ok || !d.ok) throw new Error(d.error || 'Something went wrong');
      setState('ok');
      // Two different promises, and we only make the one that's true: a slot means the invite is
      // already on its way; no slot means we email at launch and they need do nothing.
      setMsg(
        d.status === 'approved'
          ? platform === 'ios'
            ? "You're in — check your email for the TestFlight invite."
            : "You're in — we'll email you the Play beta link shortly."
          : "You're on the list — the beta is full right now, and we'll email you the moment it opens up.",
      );
      setEmail('');
    } catch (err) {
      setState('err');
      setMsg(err instanceof Error ? err.message : 'Please try again.');
    }
  }

  return (
    <>
      <div className="wl-plat" role="group" aria-label="Which phone do you have?">
        {PLATFORMS.map((pl) => (
          <button
            key={pl.id}
            type="button"
            className={`wl-plat-btn${platform === pl.id ? ' on' : ''}`}
            aria-pressed={platform === pl.id}
            onClick={() => setPlatform(pl.id)}>
            {pl.label}
          </button>
        ))}
      </div>
      <form className="wl-form" onSubmit={submit}>
        <input
          type="email"
          required
          placeholder="you@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Email address"
        />
        <button className="btn" type="submit" disabled={state === 'sending'}>
          {state === 'sending' ? 'Joining…' : 'Join the beta'}
        </button>
      </form>
      <div className={`wl-note ${state === 'ok' ? 'ok' : state === 'err' ? 'err' : ''}`}>{msg}</div>
    </>
  );
}
