// Nano Crew's own storefront reads the SAME public catalogue API every brand site uses — the app's
// Postgres is the single source of truth (prices, variants, fulfilment). This site holds no Stripe
// or Printful secret; checkout forwards to the central POS (see app/api/checkout/route.ts).
// See docs/storefront/STOREFRONT_DATA_CONTRACT.md.

export const API_BASE = process.env.NANOCREW_API || 'https://nanocrew-api.vercel.app';
export const STORE_SLUG = 'nanocrew';

export type Variant = {
  id: string;
  sku: string;
  color: string | null;
  size: string | null;
  retailPriceCents: number;
  inStock: boolean;
};

export type Product = {
  id: string;
  slug: string;
  name: string;
  descriptionMd: string | null;
  imageUrl: string | null;
  modelShots: string[];
  category: string | null;
  collection: { slug: string; name: string } | null;
  variants: Variant[];
};

export type Brand = {
  slug: string;
  name: string;
  tagline: string | null;
  logoUrl: string | null;
  listed: boolean; // public + live in the ecosystem
};

async function fetchCatalogue(storeSlug: string): Promise<Product[]> {
  try {
    const res = await fetch(`${API_BASE}/api/public/stores/${storeSlug}/products`, {
      next: { revalidate: 120 },
    });
    if (!res.ok) return [];
    const d = (await res.json()) as { products?: Product[] };
    return (d.products ?? []).map((p) => ({ ...p, modelShots: p.modelShots ?? [] }));
  } catch {
    return [];
  }
}

export async function getProducts(storeSlug: string = STORE_SLUG): Promise<Product[]> {
  return fetchCatalogue(storeSlug);
}

export async function getProduct(productSlug: string, storeSlug: string = STORE_SLUG): Promise<Product | null> {
  return (await fetchCatalogue(storeSlug)).find((p) => p.slug === productSlug) ?? null;
}

// Live brand facts (name/tagline/logo) + whether it's listed in the ecosystem.
export async function getBrand(storeSlug: string): Promise<Brand | null> {
  try {
    const res = await fetch(`${API_BASE}/api/public/stores/${storeSlug}`, { next: { revalidate: 120 } });
    if (!res.ok) return null;
    const d = (await res.json()) as { store?: { slug: string; name: string; tagline: string | null; logoUrl: string | null; isPublic?: boolean; status?: string } };
    if (!d.store) return null;
    return {
      slug: d.store.slug,
      name: d.store.name,
      tagline: d.store.tagline,
      logoUrl: d.store.logoUrl,
      listed: Boolean(d.store.isPublic) && d.store.status === 'live',
    };
  } catch {
    return null;
  }
}

// Lowest in-stock variant price, in cents — the "from" price on a card.
export function fromPriceCents(p: Product): number | null {
  const prices = p.variants.filter((v) => v.inStock).map((v) => v.retailPriceCents);
  return prices.length ? Math.min(...prices) : null;
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Distinct colors / sizes for the pickers, preserving first-seen order.
export function optionsOf(p: Product, key: 'color' | 'size'): string[] {
  const seen: string[] = [];
  for (const v of p.variants) {
    const val = v[key];
    if (val && !seen.includes(val)) seen.push(val);
  }
  return seen;
}
