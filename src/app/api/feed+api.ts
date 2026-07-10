import { and, desc, eq, inArray, min, sql } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';

// GET /api/feed — the immersive Market feed: published products from live, opted-in storefronts.
// Full-bleed and media-forward, so it leads with real photography (Veo video, then on-model shots)
// and only then newest; carries like/share counts and, when signed in, whether you liked each.
export async function GET(req: Request) {
  try {
    const rows = await db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        slug: schema.products.slug,
        imageUrl: schema.products.imageUrl,
        modelShots: schema.products.modelShots,
        videoUrl: schema.products.videoUrl,
        descriptionMd: schema.products.descriptionMd,
        shareCount: schema.products.shareCount,
        createdAt: schema.products.createdAt,
        storeName: schema.stores.name,
        storeSlug: schema.stores.slug,
        storeTagline: schema.stores.tagline,
        deploymentUrl: schema.stores.deploymentUrl,
        customDomain: schema.stores.customDomain,
        priceCents: min(schema.variants.retailPriceCents),
        likeCount: sql<number>`count(distinct ${schema.productLikes.id})`.mapWith(Number),
      })
      .from(schema.products)
      .innerJoin(schema.stores, eq(schema.products.storeId, schema.stores.id))
      .leftJoin(schema.variants, eq(schema.variants.productId, schema.products.id))
      .leftJoin(schema.productLikes, eq(schema.productLikes.productId, schema.products.id))
      // Only storefronts opted into the marketplace and taken live (matches /api/market visibility).
      .where(and(eq(schema.products.isPublished, true), eq(schema.stores.isPublic, true), eq(schema.stores.status, 'live')))
      .groupBy(schema.products.id, schema.stores.id)
      .orderBy(desc(schema.products.createdAt))
      .limit(60);

    // Media-forward order: a Veo video reads strongest full-bleed, then an on-model shot; flat
    // product mockups (no photography) sink to the end. Stable sort preserves newest-within-tier.
    const mediaScore = (r: (typeof rows)[number]) => (r.videoUrl ? 2 : 0) + ((r.modelShots?.length ?? 0) > 0 ? 1 : 0);
    rows.sort((a, b) => mediaScore(b) - mediaScore(a));

    // Which of these the signed-in viewer has liked (optional — feed works anonymously).
    let likedSet = new Set<string>();
    const user = await getUserFromRequest(req);
    if (user && rows.length) {
      const liked = await db
        .select({ productId: schema.productLikes.productId })
        .from(schema.productLikes)
        .where(
          and(
            eq(schema.productLikes.userId, user.id),
            inArray(
              schema.productLikes.productId,
              rows.map((r) => r.id),
            ),
          ),
        );
      likedSet = new Set(liked.filter((l) => l.productId).map((l) => l.productId));
    }
    // Resolve each store's public website (custom domain wins), so the feed's "Shop"
    // link points at the real storefront — not a guessed vercel subdomain. imageUrl leads with an
    // on-model shot (flat mockup fallback); modelShots is internal and stripped from the payload.
    return Response.json({
      items: rows.map(({ deploymentUrl, customDomain, modelShots, ...r }) => ({
        ...r,
        imageUrl: modelShots?.[0] ?? r.imageUrl,
        siteUrl: customDomain ? `https://${customDomain}` : (deploymentUrl ?? null),
        likedByMe: likedSet.has(r.id),
      })),
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
