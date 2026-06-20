import { desc, eq, inArray } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { accessibleStoreIds } from '@/lib/tenant';

// GET /api/creator/returns — the Studio returns inbox: every return claim across the creator's
// stores (owned + collaborated), newest first, joined with a small order summary so the inbox can
// render without a second round-trip. Ownership is scoped by accessibleStoreIds() to match the
// orders listing (the refund route's owner-only join is the divergence we deliberately avoid here).
// Token verification is local (no network), so the first I/O is a DB query — the Railway/postgres-js
// "no fetch before the first DB query" rule holds.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const storeIds = await accessibleStoreIds(user.id);
    if (!storeIds.length) return Response.json({ returns: [] });

    const rows = await db
      .select({
        id: schema.returnRequests.id,
        orderId: schema.returnRequests.orderId,
        storeId: schema.returnRequests.storeId,
        customerEmail: schema.returnRequests.customerEmail,
        reason: schema.returnRequests.reason,
        itemsJson: schema.returnRequests.itemsJson,
        photoUrls: schema.returnRequests.photoUrls,
        note: schema.returnRequests.note,
        status: schema.returnRequests.status,
        resolution: schema.returnRequests.resolution,
        refundId: schema.returnRequests.refundId,
        createdAt: schema.returnRequests.createdAt,
        resolvedAt: schema.returnRequests.resolvedAt,
        // Order summary for the card.
        orderStatus: schema.orders.status,
        orderTotalCents: schema.orders.totalCents,
        orderCreatedAt: schema.orders.createdAt,
      })
      .from(schema.returnRequests)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.returnRequests.orderId))
      .where(inArray(schema.returnRequests.storeId, storeIds))
      .orderBy(desc(schema.returnRequests.createdAt))
      .limit(200);

    return Response.json({ returns: rows });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
