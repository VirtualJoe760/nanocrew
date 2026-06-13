import { and, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';

// GET /api/creator/stats — overview numbers for every store the creator owns:
// revenue + order count (paid and beyond) and 30-day pageviews.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const stores = await db
      .select({
        id: schema.stores.id,
        slug: schema.stores.slug,
        name: schema.stores.name,
        deploymentUrl: schema.stores.deploymentUrl,
        ogImageUrl: schema.stores.ogImageUrl,
      })
      .from(schema.stores)
      .where(eq(schema.stores.creatorId, user.id));
    if (!stores.length) return Response.json({ stores: [] });
    const ids = stores.map((s) => s.id);

    const orderAgg = await db
      .select({
        storeId: schema.orders.storeId,
        orders: sql<number>`count(*)`.mapWith(Number),
        revenueCents: sql<number>`coalesce(sum(${schema.orders.totalCents}), 0)`.mapWith(Number),
      })
      .from(schema.orders)
      .where(and(inArray(schema.orders.storeId, ids), inArray(schema.orders.status, ['paid', 'submitted_to_printful', 'in_production', 'shipped', 'delivered'])))
      .groupBy(schema.orders.storeId);

    // A few product shots per store so the dashboard can show a carousel thumbnail.
    const productImgs = await db
      .select({ storeId: schema.products.storeId, imageUrl: schema.products.imageUrl })
      .from(schema.products)
      .where(and(inArray(schema.products.storeId, ids), eq(schema.products.isPublished, true), isNotNull(schema.products.imageUrl)))
      .orderBy(desc(schema.products.createdAt));

    const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const viewAgg = await db
      .select({
        storeId: schema.pageViews.storeId,
        views: sql<number>`coalesce(sum(${schema.pageViews.views}), 0)`.mapWith(Number),
      })
      .from(schema.pageViews)
      .where(and(inArray(schema.pageViews.storeId, ids), gte(schema.pageViews.day, since)))
      .groupBy(schema.pageViews.storeId);

    return Response.json({
      stores: stores.map((s) => ({
        ...s,
        orders: orderAgg.find((o) => o.storeId === s.id)?.orders ?? 0,
        revenueCents: orderAgg.find((o) => o.storeId === s.id)?.revenueCents ?? 0,
        views30d: viewAgg.find((v) => v.storeId === s.id)?.views ?? 0,
        productImages: productImgs
          .filter((p) => p.storeId === s.id && p.imageUrl)
          .map((p) => p.imageUrl as string)
          .slice(0, 6),
      })),
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
