import { desc, inArray } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { corsJson, corsPreflight } from '@/lib/cors';
import { db, schema } from '@/lib/db';
import { accessibleStoreIds } from '@/lib/tenant';

export const OPTIONS = corsPreflight;

// GET /api/creator/orders — recent orders across the creator's stores.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return corsJson({ error: 'unauthorized' }, { status: 401 });
  try {
    const memberIds = await accessibleStoreIds(user.id);
    const stores = memberIds.length
      ? await db
          .select({ id: schema.stores.id, slug: schema.stores.slug })
          .from(schema.stores)
          .where(inArray(schema.stores.id, memberIds))
      : [];
    if (!stores.length) return corsJson({ orders: [] });
    const orders = await db
      .select({
        id: schema.orders.id,
        storeId: schema.orders.storeId,
        customerEmail: schema.orders.customerEmail,
        status: schema.orders.status,
        totalCents: schema.orders.totalCents,
        createdAt: schema.orders.createdAt,
        trackingUrl: schema.orders.trackingUrl,
      })
      .from(schema.orders)
      .where(inArray(schema.orders.storeId, stores.map((s) => s.id)))
      .orderBy(desc(schema.orders.createdAt))
      .limit(100);
    return corsJson({
      orders: orders.map((o) => ({ ...o, storeSlug: stores.find((s) => s.id === o.storeId)?.slug })),
    });
  } catch (e) {
    return corsJson({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
