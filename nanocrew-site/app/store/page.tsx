import Link from 'next/link';
import type { Metadata } from 'next';

import { fromPriceCents, formatPrice, getProducts } from '@/lib/store';

export const metadata: Metadata = {
  title: 'Store — Nano Crew',
  description: 'Shop Nano Crew. Designed in-house, printed on demand, shipped worldwide.',
};

export const revalidate = 120;

export default async function StorePage() {
  const products = await getProducts();

  return (
    <main className="wrap store">
      <header className="store-head">
        <p className="eyebrow">Nano Crew</p>
        <h1>Store</h1>
      </header>

      {products.length === 0 ? (
        <div className="store-empty">
          <p>The shop is being stocked. Check back soon — or join the waitlist for the app.</p>
          <Link className="btn ghost" href="/#waitlist">
            Join the waitlist
          </Link>
        </div>
      ) : (
        <div className="store-grid">
          {products.map((p) => {
            const from = fromPriceCents(p);
            return (
              <Link key={p.id} href={`/store/${p.slug}`} className="pcard">
                <div className="pcard-img">
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl} alt={p.name} loading="lazy" />
                  ) : (
                    <div className="pcard-noimg" />
                  )}
                </div>
                <div className="pcard-meta">
                  <span className="pcard-name">{p.name}</span>
                  {from != null ? <span className="pcard-price">{formatPrice(from)}</span> : null}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
