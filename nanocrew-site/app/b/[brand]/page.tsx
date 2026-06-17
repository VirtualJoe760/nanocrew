import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Footer } from '../../site-chrome';
import { fromPriceCents, formatPrice, getBrand, getProducts } from '@/lib/store';
import { BrandNav } from './brand-nav';

export const revalidate = 120;

export async function generateMetadata({ params }: { params: Promise<{ brand: string }> }): Promise<Metadata> {
  const { brand } = await params;
  const b = await getBrand(brand);
  if (!b) return { title: 'Not found — Nano Crew' };
  return { title: `${b.name} — Nano Crew`, description: b.tagline ?? `Shop ${b.name} on Nano Crew.` };
}

// A storefront page for ANY ecosystem brand on nanocrew.app — same catalogue + POS as the in-app
// store and the HQ store. Brands without their own website are sold here; only listed (public +
// live) brands are reachable.
export default async function BrandStore({ params }: { params: Promise<{ brand: string }> }) {
  const { brand } = await params;
  const b = await getBrand(brand);
  if (!b || !b.listed) notFound();
  const products = await getProducts(brand);

  return (
    <>
      <BrandNav name={b.name} slug={b.slug} />
      <main className="wrap store">
        <header className="store-head">
          <p className="eyebrow">{b.name}</p>
          <h1>Shop</h1>
          {b.tagline ? <p className="sub" style={{ marginTop: 8 }}>{b.tagline}</p> : null}
        </header>

        {products.length === 0 ? (
          <div className="store-empty">
            <p>This shop is being stocked. Check back soon.</p>
          </div>
        ) : (
          <div className="store-grid">
            {products.map((p) => {
              const from = fromPriceCents(p);
              return (
                <Link key={p.id} href={`/b/${b.slug}/${p.slug}`} className="pcard">
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
      <Footer />
    </>
  );
}
