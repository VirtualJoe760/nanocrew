import { and, desc, eq, inArray, min, sql } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';

// GET /api/feed — published products across all public stores, newest first.
// The Nanocrew tab's vertical feed consumes this. Video-first (videoUrl) with a photo
// fallback; carries like/share counts and, when signed in, whether you liked each.
export async function GET(req: Request) {
  try {
    const rows = await db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        slug: schema.products.slug,
        imageUrl: schema.products.imageUrl,
        videoUrl: schema.products.videoUrl,
        descriptionMd: schema.products.descriptionMd,
        shareCount: schema.products.shareCount,
        createdAt: schema.products.createdAt,
        storeName: schema.stores.name,
        storeSlug: schema.stores.slug,
        storeTagline: schema.stores.tagline,
        priceCents: min(schema.variants.retailPriceCents),
        likeCount: sql<number>`count(distinct ${schema.productLikes.id})`.mapWith(Number),
      })
      .from(schema.products)
      .innerJoin(schema.stores, eq(schema.products.storeId, schema.stores.id))
      .leftJoin(schema.variants, eq(schema.variants.productId, schema.products.id))
      .leftJoin(schema.productLikes, eq(schema.productLikes.productId, schema.products.id))
      .where(eq(schema.products.isPublished, true))
      .groupBy(schema.products.id, schema.stores.id)
      .orderBy(desc(schema.products.createdAt))
      .limit(50);

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
    return Response.json({ items: rows.map((r) => ({ ...r, likedByMe: likedSet.has(r.id) })) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
