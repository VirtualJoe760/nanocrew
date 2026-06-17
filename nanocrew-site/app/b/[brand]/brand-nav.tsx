'use client';

import Link from 'next/link';

import { useCart } from '../../store/cart-store';

// Per-brand store header — the brand's name + a live bag count (shared cart at /store/cart).
export function BrandNav({ name, slug }: { name: string; slug: string }) {
  const { count } = useCart();
  return (
    <nav className="nav wrap">
      <Link href={`/b/${slug}`} className="mark" aria-label={`${name} — shop`}>
        <span className="word">{name}</span>
      </Link>
      <div className="links" style={{ alignItems: 'center' }}>
        <Link href={`/b/${slug}`}>Shop</Link>
        <Link href="/store/cart" aria-label="Cart">
          Bag{count > 0 ? ` (${count})` : ''}
        </Link>
      </div>
    </nav>
  );
}
