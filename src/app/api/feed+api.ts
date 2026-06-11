import { desc, eq, min } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// GET /api/feed — published products across all public stores, newest first.
// The Nanocrew tab's vertical feed consumes this.
export async function GET() {
  try {
    const rows = await db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        slug: schema.products.slug,
        imageUrl: schema.products.imageUrl,
        videoUrl: schema.products.videoUrl,
        descriptionMd: schema.products.descriptionMd,
        createdAt: schema.products.createdAt,
        storeName: schema.stores.name,
        storeSlug: schema.stores.slug,
        storeTagline: schema.stores.tagline,
        priceCents: min(schema.variants.retailPriceCents),
      })
      .from(schema.products)
      .innerJoin(schema.stores, eq(schema.products.storeId, schema.stores.id))
      .leftJoin(schema.variants, eq(schema.variants.productId, schema.products.id))
      .where(eq(schema.products.isPublished, true))
      .groupBy(schema.products.id, schema.stores.id)
      .orderBy(desc(schema.products.createdAt))
      .limit(50);
    return Response.json({ items: rows });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
