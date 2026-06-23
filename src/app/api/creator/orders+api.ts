import { desc, inArray } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { accessibleStoreIds } from '@/lib/tenant';

// GET /api/creator/orders — recent orders across the creator's stores (owned + collaborated).
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const stores = await db
      .select({ id: schema.stores.id, slug: schema.stores.slug })
      .from(schema.stores)
      .where(inArray(schema.stores.id, await accessibleStoreIds(user.id)));
    if (!stores.length) return Response.json({ orders: [] });
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
    return Response.json({
      orders: orders.map((o) => ({ ...o, storeSlug: stores.find((s) => s.id === o.storeId)?.slug })),
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
