import { and, asc, eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// GET /api/store/:slug/products/:pslug — one published product for the in-app product page:
// its images (main shot + on-model gallery), copy, and purchasable variants (size/colour/price).
// Public, read-only. Mirrors the public storefront contract so checkout uses the same variant ids.
export async function GET(_req: Request, { slug, pslug }: Record<string, string>) {
  try {
    const [store] = await db
      .select({ id: schema.stores.id })
      .from(schema.stores)
      .where(eq(schema.stores.slug, slug))
      .limit(1);
    if (!store) return Response.json({ error: 'store not found' }, { status: 404 });

    const [product] = await db
      .select({
        id: schema.products.id,
        slug: schema.products.slug,
        name: schema.products.name,
        descriptionMd: schema.products.descriptionMd,
        imageUrl: schema.products.imageUrl,
        videoUrl: schema.products.videoUrl,
        modelShots: schema.products.modelShots,
        modelVideos: schema.products.modelVideos,
      })
      .from(schema.products)
      .where(
        and(
          eq(schema.products.storeId, store.id),
          eq(schema.products.slug, pslug),
          eq(schema.products.isPublished, true),
        ),
      )
      .limit(1);
    if (!product) return Response.json({ error: 'product not found' }, { status: 404 });

    const variants = await db
      .select({
        id: schema.variants.id,
        sku: schema.variants.sku,
        size: schema.variants.size,
        color: schema.variants.color,
        retailPriceCents: schema.variants.retailPriceCents,
        inStock: schema.variants.inStock,
      })
      .from(schema.variants)
      .where(eq(schema.variants.productId, product.id))
      .orderBy(asc(schema.variants.retailPriceCents));

    // Carousel images: the main shot leads, then the on-model gallery. De-dupe + drop empties.
    const images = [product.imageUrl, ...(product.modelShots ?? [])].filter(
      (u, i, a): u is string => !!u && a.indexOf(u) === i,
    );

    return Response.json(
      {
        product: {
          id: product.id,
          slug: product.slug,
          name: product.name,
          descriptionMd: product.descriptionMd,
          images,
          videoUrl: product.videoUrl,
          modelVideos: product.modelVideos ?? [],
        },
        variants,
      },
      { headers: { 'Cache-Control': 'public, max-age=60' } },
    );
  } catch (e) {
    console.error('[store/:slug/products/:pslug]', e instanceof Error ? e.message : e);
    return Response.json({ error: 'internal' }, { status: 500 });
  }
}
