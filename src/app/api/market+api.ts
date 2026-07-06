import { and, desc, eq, ilike, inArray, isNotNull, min, or, sql } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// GET /api/market?q=... — data for the Market tab, composed into an Amazon-style rail feed:
//   • featured:    a marketing hero set — newest products, video/on-model-shot preferred
//   • trending:    newest published products
//   • collections: live drops (catalogues) with cover art — a "fresh drops" rail
//   • brands:      storefronts with preview art, product counts, and a store link
//   • more:        a broad product pool for the small "more to explore" rail
// `q` filters brands by name / slug / tagline and collapses the feed to search results (the
// marketing rails — featured/collections/more — are omitted while searching).
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams.get('q')?.trim();
    const searching = !!q;

    // Only storefronts the creator has opted into the marketplace and taken live.
    const storeVisible = and(eq(schema.stores.isPublic, true), eq(schema.stores.status, 'live'));

    // One product pool (newest published, from visible stores) powers featured / trending / more.
    const pool = await db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        imageUrl: schema.products.imageUrl,
        modelShots: schema.products.modelShots,
        videoUrl: schema.products.videoUrl,
        category: schema.products.category,
        storeName: schema.stores.name,
        storeSlug: schema.stores.slug,
        storeTagline: schema.stores.tagline,
        priceCents: min(schema.variants.retailPriceCents),
        createdAt: schema.products.createdAt,
      })
      .from(schema.products)
      .innerJoin(schema.stores, eq(schema.products.storeId, schema.stores.id))
      .leftJoin(schema.variants, eq(schema.variants.productId, schema.products.id))
      .where(and(eq(schema.products.isPublished, true), storeVisible))
      .groupBy(schema.products.id, schema.stores.id)
      .orderBy(desc(schema.products.createdAt))
      .limit(48);

    // Thumbnails lead with an on-model shot when the product has one (flat mockup as fallback).
    type Prod = (typeof pool)[number];
    const shot = (p: Prod) => p.modelShots?.[0] ?? p.imageUrl;
    const toItem = (p: Prod) => ({
      id: p.id,
      name: p.name,
      imageUrl: shot(p),
      videoUrl: p.videoUrl,
      storeName: p.storeName,
      storeSlug: p.storeSlug,
      storeTagline: p.storeTagline,
      priceCents: p.priceCents ?? null,
    });
    const withImage = pool.filter((p) => shot(p));

    // Featured (hero): the marketing showcase, so IMAGE QUALITY leads — real photography (a Veo
    // video, then an on-model shot) reads as marketing; flat product mockups look empty full-bleed.
    // Restrict the hero to photography when any exists; otherwise fall back so it's never empty. A
    // soft cap of 2 per brand keeps it from being one store while still leading with the best shots.
    const hasVideo = (p: Prod) => !!p.videoUrl;
    const hasModel = (p: Prod) => (p.modelShots?.length ?? 0) > 0;
    const photography = withImage.filter((p) => hasVideo(p) || hasModel(p));
    const heroPool = photography.length ? photography : withImage;
    const heroSorted = [...heroPool].sort((a, b) => (Number(hasVideo(b)) * 2 + Number(hasModel(b))) - (Number(hasVideo(a)) * 2 + Number(hasModel(a))));
    // Cap per brand at 4 — enough that a single strong photo-brand still fills the hero today, low
    // enough that it diversifies automatically as more brands add on-model shots.
    const perBrand = new Map<string, number>();
    const featured: ReturnType<typeof toItem>[] = [];
    for (const p of heroSorted) {
      const n = perBrand.get(p.storeSlug) ?? 0;
      if (n >= 4) continue;
      perBrand.set(p.storeSlug, n + 1);
      featured.push(toItem(p));
      if (featured.length >= 6) break;
    }

    const trending = withImage.slice(0, 12).map(toItem);
    const more = withImage.slice(0, 30).map(toItem);

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

    // Preview art: up to 4 on-model shots per brand (its "catalogue" strip).
    const brandIds = brands.map((b) => b.id);
    const previewRows = brandIds.length
      ? await db
          .select({ storeId: schema.products.storeId, imageUrl: schema.products.imageUrl, modelShots: schema.products.modelShots })
          .from(schema.products)
          .where(and(eq(schema.products.isPublished, true), inArray(schema.products.storeId, brandIds)))
          .orderBy(desc(schema.products.createdAt))
          .limit(160)
      : [];
    const previewsByStore = new Map<string, string[]>();
    for (const row of previewRows) {
      const src = row.modelShots?.[0] ?? row.imageUrl;
      if (!src) continue;
      const arr = previewsByStore.get(row.storeId) ?? [];
      if (arr.length < 4) arr.push(src);
      previewsByStore.set(row.storeId, arr);
    }

    // Collections (drops) — active catalogues with cover art from visible stores. Skipped while
    // searching (the feed collapses to brand/product matches then).
    const collections = searching
      ? []
      : await db
          .select({
            slug: schema.catalogues.slug,
            name: schema.catalogues.name,
            season: schema.catalogues.season,
            coverImageUrl: schema.catalogues.coverImageUrl,
            storeSlug: schema.stores.slug,
            storeName: schema.stores.name,
          })
          .from(schema.catalogues)
          .innerJoin(schema.stores, eq(schema.catalogues.storeId, schema.stores.id))
          .where(and(eq(schema.catalogues.isActive, true), isNotNull(schema.catalogues.coverImageUrl), storeVisible))
          .orderBy(schema.catalogues.sortOrder, desc(schema.catalogues.createdAt))
          .limit(12);

    return Response.json({
      featured: searching ? [] : featured,
      trending,
      collections,
      brands: brands.map((b) => ({ ...b, previews: previewsByStore.get(b.id) ?? [] })),
      more: searching ? [] : more,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
