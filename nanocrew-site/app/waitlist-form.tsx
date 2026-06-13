'use client';

import { useState } from 'react';

export function WaitlistForm() {
  const [email, setEmail] = useState('');
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
        body: JSON.stringify({ email: email.trim() }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) throw new Error(d.error || 'Something went wrong');
      setState('ok');
      setMsg("You're on the list — we'll email you when Nanocrew opens.");
      setEmail('');
    } catch (err) {
      setState('err');
      setMsg(err instanceof Error ? err.message : 'Please try again.');
    }
  }

  return (
    <>
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
          {state === 'sending' ? 'Joining…' : 'Join the waitlist'}
        </button>
      </form>
      <div className={`wl-note ${state === 'ok' ? 'ok' : state === 'err' ? 'err' : ''}`}>{msg}</div>
    </>
  );
}
