'use client';

import Link from 'next/link';
import { useState } from 'react';

import { EveMark } from '../eve-mark';

import { useCart } from './cart-store';

// Store header — same NC mark + hamburger as the marketing nav, plus a live cart count.
export function StoreNav() {
  const { count } = useCart();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const bag = `Bag${count > 0 ? ` (${count})` : ''}`;
  return (
    <nav className="nav wrap">
      <Link href="/" className="mark" aria-label="Nano Crew — home" onClick={close}>
        <span className="nc"><EveMark size={34} /></span>
        <span className="word">Nano Crew</span>
      </Link>

      <div className="links links-desktop" style={{ alignItems: 'center' }}>
        <Link href="/store">Store</Link>
        <Link href="/#how">How it works</Link>
        <Link href="/store/cart" aria-label="Cart">
          {bag}
        </Link>
      </div>

      <button
        type="button"
        className="nav-toggle"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`burger${open ? ' open' : ''}`} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </button>

      {open ? (
        <div className="links-mobile">
          <Link href="/store" onClick={close}>
            Store
          </Link>
          <Link href="/#how" onClick={close}>
            How it works
          </Link>
          <Link href="/store/cart" aria-label="Cart" onClick={close}>
            {bag}
          </Link>
        </div>
      ) : null}
    </nav>
  );
}
