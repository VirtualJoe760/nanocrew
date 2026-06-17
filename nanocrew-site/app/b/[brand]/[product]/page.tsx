import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Footer } from '../../../site-chrome';
import { fromPriceCents, formatPrice, getBrand, getProduct } from '@/lib/store';
import { BuyPanel } from '../../../store/[slug]/buy-panel';
import { BrandNav } from '../brand-nav';

export const revalidate = 120;

export async function generateMetadata({ params }: { params: Promise<{ brand: string; product: string }> }): Promise<Metadata> {
  const { brand, product } = await params;
  const p = await getProduct(product, brand);
  if (!p) return { title: 'Not found — Nano Crew' };
  return {
    title: `${p.name} — Nano Crew`,
    description: p.descriptionMd?.slice(0, 150) ?? `Shop ${p.name}.`,
    openGraph: { images: p.imageUrl ? [p.imageUrl] : [] },
  };
}

export default async function BrandProduct({ params }: { params: Promise<{ brand: string; product: string }> }) {
  const { brand, product } = await params;
  const b = await getBrand(brand);
  if (!b || !b.listed) notFound();
  const p = await getProduct(product, brand);
  if (!p) notFound();

  const from = fromPriceCents(p);
  const gallery = [p.imageUrl, ...p.modelShots].filter((x): x is string => Boolean(x));

  return (
    <>
      <BrandNav name={b.name} slug={b.slug} />
      <main className="wrap product">
        <Link href={`/b/${b.slug}`} className="back">
          ← {b.name}
        </Link>
        <div className="product-grid">
          <div className="product-gallery">
            {gallery.length ? (
              gallery.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={src} alt={`${p.name} ${i + 1}`} loading={i === 0 ? 'eager' : 'lazy'} />
              ))
            ) : (
              <div className="pcard-noimg" />
            )}
          </div>
          <div className="product-info">
            <h1>{p.name}</h1>
            {from != null ? <p className="product-price">{formatPrice(from)}</p> : null}
            {p.descriptionMd ? <p className="product-desc">{p.descriptionMd}</p> : null}
            <BuyPanel product={p} storeSlug={b.slug} />
            <p className="product-note">
              Printed on demand &amp; shipped worldwide. Secure checkout — payment handled by Nano Crew.
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
