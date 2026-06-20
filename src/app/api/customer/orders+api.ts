import { desc, eq, inArray, sql } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';

// GET /api/customer/orders — the signed-in buyer's "Purchases" surface. Returns every order placed
// against the account email (lower(customerEmail) = lower(user.email)), newest first, each with its
// line items, status, tracking, return window, and whether a return can still be requested. This is
// a DIRECT API (a plain DB read), not the forge. Token verification is local (no network), so the
// first I/O is a DB query per the Railway/postgres-js "no fetch before the first DB query" rule.
//
// Statuses where a return can't be opened (matches POST /api/public/returns).
const NOT_CLAIMABLE = ['refunded', 'cancelled', 'failed', 'return_requested', 'pending_payment'];

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const email = user.email.toLowerCase();
    const orders = await db
      .select({
        id: schema.orders.id,
        storeId: schema.orders.storeId,
        status: schema.orders.status,
        totalCents: schema.orders.totalCents,
        currency: schema.orders.currency,
        trackingUrl: schema.orders.trackingUrl,
        trackingNumber: schema.orders.trackingNumber,
        shippedAt: schema.orders.shippedAt,
        returnWindowEndsAt: schema.orders.returnWindowEndsAt,
        createdAt: schema.orders.createdAt,
        storeSlug: schema.stores.slug,
        storeName: schema.stores.name,
      })
      .from(schema.orders)
      .innerJoin(schema.stores, eq(schema.stores.id, schema.orders.storeId))
      .where(sql`lower(${schema.orders.customerEmail}) = ${email}`)
      .orderBy(desc(schema.orders.createdAt))
      .limit(100);
    if (!orders.length) return Response.json({ orders: [] });

    // Fetch all line items for the returned orders in one query, then group by orderId.
    const orderIds = orders.map((o) => o.id);
    const items = await db
      .select({
        orderId: schema.orderItems.orderId,
        name: schema.orderItems.nameSnapshot,
        variant: schema.orderItems.variantSnapshot,
        quantity: schema.orderItems.quantity,
        unitPriceCents: schema.orderItems.unitPriceCents,
      })
      .from(schema.orderItems)
      .where(inArray(schema.orderItems.orderId, orderIds));

    const itemsByOrder = new Map<string, typeof items>();
    for (const it of items) {
      const list = itemsByOrder.get(it.orderId) ?? [];
      list.push(it);
      itemsByOrder.set(it.orderId, list);
    }

    const now = Date.now();
    return Response.json({
      orders: orders.map((o) => {
        const inWindow = !!o.returnWindowEndsAt && now < o.returnWindowEndsAt.getTime();
        return {
          ...o,
          items: itemsByOrder.get(o.id) ?? [],
          canRequestReturn: inWindow && !NOT_CLAIMABLE.includes(o.status),
        };
      }),
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
