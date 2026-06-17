'use client';

import Link from 'next/link';
import { useState } from 'react';

import { formatPrice } from '@/lib/store';
import { useCart } from '../cart-store';

export default function CartPage() {
  const { lines, setQuantity, remove, count } = useCart();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subtotal = lines.reduce((n, l) => n + l.priceCents * l.quantity, 0);

  const checkout = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeSlug: lines[0]?.storeSlug, items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })) }),
      });
      const d = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !d.url) throw new Error(d.error ?? 'Checkout failed.');
      window.location.href = d.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed.');
      setBusy(false);
    }
  };

  if (count === 0) {
    return (
      <main className="wrap cart">
        <h1>Your bag</h1>
        <p className="cart-empty">Your bag is empty.</p>
        <Link className="btn ghost" href="/store">
          Browse the store
        </Link>
      </main>
    );
  }

  return (
    <main className="wrap cart">
      <h1>Your bag</h1>
      <ul className="cart-lines">
        {lines.map((l) => (
          <li key={l.variantId} className="cart-line">
            <div className="cart-img">
              {l.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={l.image} alt={l.name} />
              ) : (
                <div className="pcard-noimg" />
              )}
            </div>
            <div className="cart-detail">
              <Link href={`/store/${l.productSlug}`} className="cart-name">
                {l.name}
              </Link>
              <span className="cart-variant">
                {[l.color, l.size].filter(Boolean).join(' · ')}
              </span>
              <div className="cart-qty">
                <button type="button" onClick={() => setQuantity(l.variantId, l.quantity - 1)} aria-label="Decrease">
                  −
                </button>
                <span>{l.quantity}</span>
                <button type="button" onClick={() => setQuantity(l.variantId, l.quantity + 1)} aria-label="Increase">
                  +
                </button>
                <button type="button" className="cart-remove" onClick={() => remove(l.variantId)}>
                  Remove
                </button>
              </div>
            </div>
            <span className="cart-line-price">{formatPrice(l.priceCents * l.quantity)}</span>
          </li>
        ))}
      </ul>

      <div className="cart-foot">
        <div className="cart-subtotal">
          <span>Subtotal</span>
          <span>{formatPrice(subtotal)}</span>
        </div>
        <p className="cart-tax">Shipping &amp; tax calculated at checkout.</p>
        <button type="button" className="btn" onClick={checkout} disabled={busy}>
          {busy ? 'Redirecting…' : 'Checkout'}
        </button>
        {error ? <p className="cart-error">{error}</p> : null}
      </div>
    </main>
  );
}
