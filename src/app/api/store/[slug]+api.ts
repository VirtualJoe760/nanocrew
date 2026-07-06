import { and, asc, desc, eq, min } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// GET /api/store/:slug — the in-app storefront for one brand: header (logo, tagline, OG
// art) plus published products grouped into collections/drops. Products with no catalogue
// fall into a trailing "More" group so nothing is hidden. Public, read-only.
export async function GET(_req: Request, { slug }: Record<string, string>) {
  try {
    const [store] = await db
      .select({
        id: schema.stores.id,
        slug: schema.stores.slug,
        name: schema.stores.name,
        tagline: schema.stores.tagline,
        logoUrl: schema.stores.logoUrl,
        ogImageUrl: schema.stores.ogImageUrl,
        deploymentUrl: schema.stores.deploymentUrl,
        customDomain: schema.stores.customDomain,
        designSystem: schema.stores.designSystem,
      })
      .from(schema.stores)
      .where(eq(schema.stores.slug, slug))
      .limit(1);
    if (!store) return Response.json({ error: 'store not found' }, { status: 404 });

    // Published products with their cheapest variant price and which catalogue they belong to.
    const products = await db
      .select({
        id: schema.products.id,
        slug: schema.products.slug,
        name: schema.products.name,
        imageUrl: schema.products.imageUrl,
        modelShots: schema.products.modelShots,
        videoUrl: schema.products.videoUrl,
        catalogueId: schema.products.catalogueId,
        priceCents: min(schema.variants.retailPriceCents),
        createdAt: schema.products.createdAt,
      })
      .from(schema.products)
      .leftJoin(schema.variants, eq(schema.variants.productId, schema.products.id))
      .where(and(eq(schema.products.storeId, store.id), eq(schema.products.isPublished, true)))
      .groupBy(schema.products.id)
      .orderBy(desc(schema.products.createdAt));

    const catalogues = await db
      .select({
        id: schema.catalogues.id,
        slug: schema.catalogues.slug,
        name: schema.catalogues.name,
        season: schema.catalogues.season,
        coverImageUrl: schema.catalogues.coverImageUrl,
        sortOrder: schema.catalogues.sortOrder,
      })
      .from(schema.catalogues)
      .where(and(eq(schema.catalogues.storeId, store.id), eq(schema.catalogues.isActive, true)))
      .orderBy(asc(schema.catalogues.sortOrder));

    type ProductOut = { id: string; slug: string; name: string; imageUrl: string | null; videoUrl: string | null; priceCents: number | null };
    const toOut = (p: (typeof products)[number]): ProductOut => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      // Prefer an on-model shot over the flat Printful mockup (same field name for clients).
      imageUrl: p.modelShots?.[0] ?? p.imageUrl,
      videoUrl: p.videoUrl,
      priceCents: p.priceCents ?? null,
    });

    const collections: {
      slug: string;
      name: string;
      season: string | null;
      coverImageUrl: string | null;
      products: ProductOut[];
    }[] = [];

    for (const c of catalogues) {
      const items = products.filter((p) => p.catalogueId === c.id).map(toOut);
      if (items.length) {
        collections.push({
          slug: c.slug,
          name: c.name,
          season: c.season,
          // Fall back to the newest product shot when no explicit cover is set.
          coverImageUrl: c.coverImageUrl ?? items.find((i) => i.imageUrl)?.imageUrl ?? null,
          products: items,
        });
      }
    }

    // Anything not in a catalogue still shows, in a trailing group.
    const loose = products.filter((p) => !p.catalogueId).map(toOut);
    if (loose.length) {
      collections.push({ slug: 'more', name: 'More', season: null, coverImageUrl: loose.find((i) => i.imageUrl)?.imageUrl ?? null, products: loose });
    }

    const palette = (store.designSystem as { palette?: { role: string; hex: string }[] } | null)?.palette ?? [];
    const pick = (role: string) => palette.find((p) => p.role.toLowerCase().includes(role))?.hex ?? null;

    return Response.json(
      {
        brand: {
          slug: store.slug,
          name: store.name,
          tagline: store.tagline,
          logoUrl: store.logoUrl,
          ogImageUrl: store.ogImageUrl,
          siteUrl: store.customDomain ? `https://${store.customDomain}` : store.deploymentUrl && !store.deploymentUrl.includes('github.com') ? store.deploymentUrl : null,
          bgHex: pick('background'),
          textHex: pick('text'),
          accentHex: pick('primary') ?? pick('accent'),
        },
        productCount: products.length,
        collections,
      },
      { headers: { 'Cache-Control': 'public, max-age=120' } },
    );
  } catch (e) {
    console.error('[store/:slug]', e instanceof Error ? e.message : e);
    return Response.json({ error: 'internal' }, { status: 500 });
  }
}
