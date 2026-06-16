'use client';

import Link from 'next/link';

import { useCart } from './cart-store';

// Store header — same NC mark as the marketing nav, plus a live cart count.
export function StoreNav() {
  const { count } = useCart();
  return (
    <nav className="nav wrap">
      <Link href="/" className="mark" aria-label="Nano Crew — home">
        <span className="nc">NC</span>
        <span className="word">Nano Crew</span>
      </Link>
      <div className="links" style={{ alignItems: 'center' }}>
        <Link href="/store">Store</Link>
        <Link href="/#how">How it works</Link>
        <Link href="/store/cart" aria-label="Cart">
          Bag{count > 0 ? ` (${count})` : ''}
        </Link>
      </div>
    </nav>
  );
}
