'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { optionsOf, STORE_SLUG, type Product } from '@/lib/store';
import { useCart } from '../cart-store';

// Variant selection → resolve the exact variant id → add to the cart. The cart only ever holds a
// variant id + display info; the POS re-prices from the DB at checkout. `storeSlug` defaults to the
// HQ store but is passed explicitly for per-brand pages (nanocrew.app/b/<brand>).
export function BuyPanel({ product, storeSlug = STORE_SLUG }: { product: Product; storeSlug?: string }) {
  const colors = useMemo(() => optionsOf(product, 'color'), [product]);
  const sizes = useMemo(() => optionsOf(product, 'size'), [product]);
  const { add } = useCart();

  const [color, setColor] = useState<string | null>(colors[0] ?? null);
  const [size, setSize] = useState<string | null>(sizes[0] ?? null);
  const [added, setAdded] = useState(false);

  const variant = product.variants.find(
    (v) => (colors.length ? v.color === color : true) && (sizes.length ? v.size === size : true),
  );
  const available = variant?.inStock ?? false;

  const onAdd = () => {
    if (!variant || !available) return;
    add({
      variantId: variant.id,
      storeSlug,
      productSlug: product.slug,
      name: product.name,
      color: variant.color,
      size: variant.size,
      priceCents: variant.retailPriceCents,
      image: product.imageUrl,
    });
    setAdded(true);
  };

  return (
    <div className="buy">
      {colors.length > 0 && (
        <div className="opt">
          <span className="opt-label">Color</span>
          <div className="opt-choices">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                className={`chip${c === color ? ' on' : ''}`}
                onClick={() => { setColor(c); setAdded(false); }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}
      {sizes.length > 0 && (
        <div className="opt">
          <span className="opt-label">Size</span>
          <div className="opt-choices">
            {sizes.map((s) => (
              <button
                key={s}
                type="button"
                className={`chip${s === size ? ' on' : ''}`}
                onClick={() => { setSize(s); setAdded(false); }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <button type="button" className="btn" onClick={onAdd} disabled={!available}>
        {available ? 'Add to bag' : 'Sold out'}
      </button>
      {added ? (
        <Link href="/store/cart" className="buy-go">
          Added — view bag →
        </Link>
      ) : null}
    </div>
  );
}
