import { and, desc, eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { corsJson, corsPreflight } from '@/lib/cors';

export const OPTIONS = corsPreflight;

// GET /api/public/stores/:slug/products — the headless storefront catalog.
// Published products only; shape mirrors the templates' lib/api.ts contract.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const [store] = await db
      .select({ id: schema.stores.id })
      .from(schema.stores)
      .where(eq(schema.stores.slug, slug))
      .limit(1);
    if (!store) return corsJson({ error: 'store not found' }, { status: 404 });

    const rows = await db
      .select({
        id: schema.products.id,
        slug: schema.products.slug,
        name: schema.products.name,
        descriptionMd: schema.products.descriptionMd,
        imageUrl: schema.products.imageUrl,
        modelShots: schema.products.modelShots,
        modelVideos: schema.products.modelVideos,
        category: schema.products.category,
        collectionSlug: schema.catalogues.slug,
        collectionName: schema.catalogues.name,
        variantId: schema.variants.id,
        sku: schema.variants.sku,
        color: schema.variants.color,
        size: schema.variants.size,
        retailPriceCents: schema.variants.retailPriceCents,
        inStock: schema.variants.inStock,
      })
      .from(schema.products)
      .leftJoin(schema.variants, eq(schema.variants.productId, schema.products.id))
      .leftJoin(schema.catalogues, eq(schema.catalogues.id, schema.products.catalogueId))
      .where(and(eq(schema.products.storeId, store.id), eq(schema.products.isPublished, true)))
      // NEWEST FIRST (2026-08-20): this is the storefronts' drop feed — templates take the head
      // of the list for "Latest Drop" rails, and oldest-first meant a new product could NEVER
      // appear there (Joe's bulldog-tee report; BUG_AUDIT_2026-08-20).
      .orderBy(desc(schema.products.createdAt));

    type Out = {
      id: string;
      slug: string;
      name: string;
      descriptionMd: string | null;
      imageUrl: string | null;
      mockupUrl: string | null;
      modelShots: string[];
      modelVideos: string[];
      category: string | null;
      collection: { slug: string; name: string } | null;
      variants: { id: string; sku: string; color: string | null; size: string | null; retailPriceCents: number; inStock: boolean }[];
    };
    const byId = new Map<string, Out>();
    for (const r of rows) {
      let p = byId.get(r.id);
      if (!p) {
        p = {
          id: r.id,
          slug: r.slug,
          name: r.name,
          descriptionMd: r.descriptionMd,
          // ON-MODEL BY DEFAULT: the card image is a model WEARING the product when shots exist —
          // never the flat slapped-on mockup (Joe, 2026-08-17). The flat render stays available
          // as mockupUrl; product-page galleries still get the full modelShots array.
          imageUrl: (r.modelShots && r.modelShots[0]) || r.imageUrl,
          mockupUrl: r.imageUrl,
          modelShots: r.modelShots ?? [],
          modelVideos: r.modelVideos ?? [],
          category: r.category,
          collection: r.collectionSlug ? { slug: r.collectionSlug, name: r.collectionName! } : null,
          variants: [],
        };
        byId.set(r.id, p);
      }
      if (r.variantId) {
        p.variants.push({ id: r.variantId, sku: r.sku!, color: r.color, size: r.size, retailPriceCents: r.retailPriceCents!, inStock: r.inStock! });
      }
    }
    const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
    const products = [...byId.values()].filter((p) => p.variants.length > 0);
    for (const p of products) {
      p.variants.sort((a, b) => SIZE_ORDER.indexOf(a.size ?? '') - SIZE_ORDER.indexOf(b.size ?? ''));
    }
    return corsJson({ products }, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch (e) {
    console.error('[public/products]', e instanceof Error ? e.message : e);
    return corsJson({ error: 'internal' }, { status: 500 });
  }
}
