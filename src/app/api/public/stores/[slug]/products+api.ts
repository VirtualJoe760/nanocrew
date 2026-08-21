import { and, desc, eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// GET /api/public/stores/:slug/products — the headless storefront catalog.
// Public, read-only, published products only. Shape mirrors the templates'
// lib/api.ts Product/Variant types exactly; cached by the sites for 5 minutes.
export async function GET(_req: Request, { slug }: Record<string, string>) {
  try {
    const [store] = await db
      .select({ id: schema.stores.id })
      .from(schema.stores)
      .where(eq(schema.stores.slug, slug))
      .limit(1);
    if (!store) return Response.json({ error: 'store not found' }, { status: 404 });

    const rows = await db
      .select({
        id: schema.products.id,
        slug: schema.products.slug,
        name: schema.products.name,
        descriptionMd: schema.products.descriptionMd,
        imageUrl: schema.products.imageUrl,
        category: schema.products.category,
        variantId: schema.variants.id,
        sku: schema.variants.sku,
        color: schema.variants.color,
        size: schema.variants.size,
        retailPriceCents: schema.variants.retailPriceCents,
        inStock: schema.variants.inStock,
      })
      .from(schema.products)
      .leftJoin(schema.variants, eq(schema.variants.productId, schema.products.id))
      .where(and(eq(schema.products.storeId, store.id), eq(schema.products.isPublished, true)))
      // NEWEST FIRST — the storefronts' drop feed. Templates take the head of this list for their
      // "Latest Drop" rail, so oldest-first meant a new product could never appear there (Joe's
      // bulldog report; BUG_AUDIT_2026-08-20 #1c). MUST match platform-api's copy of this route —
      // brands point at one host or the other via brand.json's apiBase.
      .orderBy(desc(schema.products.createdAt));

    const byId = new Map<
      string,
      {
        id: string;
        slug: string;
        name: string;
        descriptionMd: string | null;
        imageUrl: string | null;
        category: string | null;
        variants: { id: string; sku: string; color: string | null; size: string | null; retailPriceCents: number; inStock: boolean }[];
      }
    >();
    for (const r of rows) {
      let p = byId.get(r.id);
      if (!p) {
        p = {
          id: r.id,
          slug: r.slug,
          name: r.name,
          descriptionMd: r.descriptionMd,
          imageUrl: r.imageUrl,
          category: r.category,
          variants: [],
        };
        byId.set(r.id, p);
      }
      if (r.variantId) {
        p.variants.push({
          id: r.variantId,
          sku: r.sku!,
          color: r.color,
          size: r.size,
          retailPriceCents: r.retailPriceCents!,
          inStock: r.inStock!,
        });
      }
    }

    return Response.json(
      { products: [...byId.values()].filter((p) => p.variants.length > 0) },
      { headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' } },
    );
  } catch (e) {
    console.error('[public/products]', e instanceof Error ? e.message : e);
    return Response.json({ error: 'internal' }, { status: 500 });
  }
}
