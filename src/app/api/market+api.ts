import { and, desc, eq, ilike, inArray, min, or, sql } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// GET /api/market?q=... — data for the Market tab:
//   • trending: newest published products across public, live storefronts
//   • brands:   those storefronts with preview art, product counts, and a store link
// `q` filters brands by name / slug / tagline.
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams.get('q')?.trim();

    // Only storefronts the creator has opted into the marketplace and taken live.
    const storeVisible = and(eq(schema.stores.isPublic, true), eq(schema.stores.status, 'live'));

    // Trending — newest published products, with the cheapest variant price.
    const trending = await db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        imageUrl: schema.products.imageUrl,
        videoUrl: schema.products.videoUrl,
        storeName: schema.stores.name,
        storeSlug: schema.stores.slug,
        priceCents: min(schema.variants.retailPriceCents),
      })
      .from(schema.products)
      .innerJoin(schema.stores, eq(schema.products.storeId, schema.stores.id))
      .leftJoin(schema.variants, eq(schema.variants.productId, schema.products.id))
      .where(and(eq(schema.products.isPublished, true), storeVisible))
      .groupBy(schema.products.id, schema.stores.id)
      .orderBy(desc(schema.products.createdAt))
      .limit(12);

    // Brands — storefronts with published-product counts, optionally filtered by `q`.
    const brandWhere = q
      ? and(
          storeVisible,
          or(
            ilike(schema.stores.name, `%${q}%`),
            ilike(schema.stores.slug, `%${q}%`),
            ilike(schema.stores.tagline, `%${q}%`),
          ),
        )
      : storeVisible;

    const brands = await db
      .select({
        id: schema.stores.id,
        name: schema.stores.name,
        slug: schema.stores.slug,
        tagline: schema.stores.tagline,
        logoUrl: schema.stores.logoUrl,
        deploymentUrl: schema.stores.deploymentUrl,
        customDomain: schema.stores.customDomain,
        productCount: sql<number>`count(distinct ${schema.products.id})`.mapWith(Number),
      })
      .from(schema.stores)
      .leftJoin(
        schema.products,
        and(eq(schema.products.storeId, schema.stores.id), eq(schema.products.isPublished, true)),
      )
      .where(brandWhere)
      .groupBy(schema.stores.id)
      .orderBy(schema.stores.sortOrder, desc(schema.stores.createdAt))
      .limit(30);

    // Preview art: up to 4 published product images per brand (its "catalogue" strip).
    const brandIds = brands.map((b) => b.id);
    const previewRows = brandIds.length
      ? await db
          .select({
            storeId: schema.products.storeId,
            imageUrl: schema.products.imageUrl,
          })
          .from(schema.products)
          .where(and(eq(schema.products.isPublished, true), inArray(schema.products.storeId, brandIds)))
          .orderBy(desc(schema.products.createdAt))
      : [];

    const previewsByStore = new Map<string, string[]>();
    for (const row of previewRows) {
      if (!row.imageUrl) continue;
      const arr = previewsByStore.get(row.storeId) ?? [];
      if (arr.length < 4) arr.push(row.imageUrl);
      previewsByStore.set(row.storeId, arr);
    }

    return Response.json({
      trending,
      brands: brands.map((b) => ({ ...b, previews: previewsByStore.get(b.id) ?? [] })),
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
