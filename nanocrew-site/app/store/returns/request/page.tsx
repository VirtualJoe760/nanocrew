'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { LookedUpOrder, ReturnReason } from '@/lib/store';

// Request a return — a two-step guest flow (look the order up by email + order #, then file the claim).
// Both steps proxy through this site's own /api/{order-lookup,returns} routes to the central Nano Crew
// platform, which owns all the commerce logic (window validation, refunds, emails). Returns are scoped
// to defect/wrong/damaged/not-received — every piece is made to order. See docs/accounts/RETURNS_REFUNDS.md.

const REASONS: { value: ReturnReason; label: string; needsPhoto: boolean }[] = [
  { value: 'defective', label: 'Defective — a misprint or manufacturing fault', needsPhoto: true },
  { value: 'wrong_item', label: 'Wrong item — not what I ordered', needsPhoto: false },
  { value: 'damaged', label: 'Damaged in transit', needsPhoto: true },
  { value: 'not_received', label: 'Not received — tracking says delivered, it never arrived', needsPhoto: false },
];

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  border: '1px solid var(--line)',
  borderRadius: 10,
  background: '#fff',
  color: 'var(--ink)',
  font: 'inherit',
};
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--dim)',
  margin: '0 0 8px',
};

export default function RequestReturn() {
  const [order, setOrder] = useState<LookedUpOrder | null>(null);
  const [email, setEmail] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [reason, setReason] = useState<ReturnReason>('defective');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const needsPhoto = REASONS.find((r) => r.value === reason)?.needsPhoto ?? false;

  const lookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/order-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), orderNumber: orderNumber.trim() }),
      });
      const d = (await res.json().catch(() => null)) as { order?: LookedUpOrder; error?: string } | null;
      if (res.status === 404 || !d?.order) {
        setError("We couldn't find an order with that email and order number.");
      } else if (!res.ok) {
        setError(d.error ?? 'Lookup failed.');
      } else if (!d.order.inWindow) {
        setOrder(d.order);
        setError('The 7-day return window for this order has closed.');
      } else {
        setOrder(d.order);
      }
    } catch {
      setError('Lookup failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      const photoUrls = photos
        .split(/[\s,]+/)
        .map((u) => u.trim())
        .filter(Boolean);
      if (needsPhoto && photoUrls.length === 0) {
        setError('Please add a photo link of the issue for a defective or damaged item.');
        setBusy(false);
        return;
      }
      const res = await fetch('/api/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          reason,
          note: note.trim() || undefined,
          photoUrls: photoUrls.length ? photoUrls : undefined,
        }),
      });
      const d = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok || !d?.id) throw new Error(d?.error ?? 'Could not open your return.');
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open your return.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <main className="wrap prose">
        <p className="eyebrow">Claim opened</p>
        <h1>We&apos;re on it.</h1>
        <p>
          Your return claim is in and a confirmation is on its way to your email. We&apos;ll review it and
          follow up with the resolution — a free reprint or a refund.
        </p>
        <p>
          <Link className="btn ghost" href="/store">
            Back to the store
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="wrap prose">
      <h1>Request a return</h1>
      <p>
        Made-to-order means we can&apos;t take buyer&apos;s-remorse returns or size swaps, but if your
        order is defective, wrong, damaged, or never arrived, we&apos;ll make it right within 7 days of
        shipping. See the <Link href="/store/returns">full returns policy</Link>.
      </p>

      {!order ? (
        <form onSubmit={lookup} style={{ display: 'grid', gap: 18, maxWidth: 460, marginTop: 8 }}>
          <label>
            <span style={labelStyle}>Email used at checkout</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              style={fieldStyle}
            />
          </label>
          <label>
            <span style={labelStyle}>Order number</span>
            <input
              required
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              placeholder="From your confirmation email"
              style={fieldStyle}
            />
          </label>
          <div>
            <button className="btn" type="submit" disabled={busy}>
              {busy ? 'Looking up…' : 'Find my order'}
            </button>
          </div>
          {error ? <p className="cart-error">{error}</p> : null}
        </form>
      ) : (
        <form onSubmit={submit} style={{ display: 'grid', gap: 20, maxWidth: 520, marginTop: 8 }}>
          <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ ...labelStyle, margin: '0 0 6px' }}>Order {order.id.slice(0, 8)}</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {order.items.map((i, idx) => (
                <li key={idx}>
                  {i.quantity}× {i.name}
                  {i.variant ? ` — ${i.variant}` : ''}
                </li>
              ))}
            </ul>
          </div>

          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 10 }} disabled={!order.inWindow}>
            <legend style={labelStyle}>What&apos;s the issue?</legend>
            {REASONS.map((r) => (
              <label key={r.value} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 15 }}>
                <input
                  type="radio"
                  name="reason"
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                  style={{ marginTop: 4 }}
                />
                <span>{r.label}</span>
              </label>
            ))}
          </fieldset>

          {needsPhoto ? (
            <label>
              <span style={labelStyle}>Photo link(s) of the issue</span>
              <input
                value={photos}
                onChange={(e) => setPhotos(e.target.value)}
                placeholder="Paste an image URL (required for defective/damaged)"
                style={fieldStyle}
              />
              <span style={{ display: 'block', marginTop: 6, fontSize: 12, color: 'var(--dim)' }}>
                A photo is required so we can triage the claim.
              </span>
            </label>
          ) : null}

          <label>
            <span style={labelStyle}>Anything else? (optional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Tell us what went wrong"
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
          </label>

          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <button className="btn" type="submit" disabled={busy || !order.inWindow}>
              {busy ? 'Submitting…' : 'Submit return claim'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOrder(null);
                setError(null);
              }}
              style={{ background: 'none', border: 0, color: 'var(--dim)', cursor: 'pointer', textDecoration: 'underline', font: 'inherit' }}
            >
              Look up a different order
            </button>
          </div>
          {error ? <p className="cart-error">{error}</p> : null}
        </form>
      )}
    </main>
  );
}
