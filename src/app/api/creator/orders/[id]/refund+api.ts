import { and, eq, inArray } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { refundOrder } from '@/lib/connect';
import { accessibleStoreIds } from '@/lib/tenant';

// POST /api/creator/orders/:id/refund — refund one of the creator's own orders from the app
// (parity with the brand-site /admin). Full refund; the money movement is routed through
// refundOrder(), which branches on payoutStatus (held→skip the un-sent transfer, released→reverse
// it). Mirrors the platform-api route. See docs/accounts/RETURNS_REFUNDS.md.
//
// SCOPE: owner OR collaborator (Joe, 2026-08-20 — BUG_AUDIT #29). Approving a RETURN already
// triggers this same refund path and has always been collaborator-scoped, so owner-only here was
// an incoherent split, not a safeguard: a collaborator could move the money through the other
// door. Both doors now carry the same permission.
const REFUNDABLE = ['paid', 'submitted_to_printful', 'in_production', 'shipped', 'delivered', 'on_hold', 'returned', 'return_requested'];

export async function POST(req: Request, { id }: Record<string, string>) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // Every store this creator can act on — owned + collaborated (same set the returns inbox uses).
  const storeIds = await accessibleStoreIds(user.id);
  if (!storeIds.length) return Response.json({ error: 'not found' }, { status: 404 });

  const [order] = await db
    .select({
      id: schema.orders.id,
      status: schema.orders.status,
      paymentIntentId: schema.orders.stripePaymentIntentId,
    })
    .from(schema.orders)
    .innerJoin(schema.stores, eq(schema.stores.id, schema.orders.storeId))
    .where(and(eq(schema.orders.id, id), inArray(schema.orders.storeId, storeIds)))
    .limit(1);
  if (!order) return Response.json({ error: 'not found' }, { status: 404 });
  if (order.status === 'refunded') return Response.json({ status: 'refunded' }); // idempotent
  if (!REFUNDABLE.includes(order.status)) return Response.json({ error: `cannot refund a ${order.status} order` }, { status: 409 });
  if (!order.paymentIntentId) return Response.json({ error: 'no payment to refund' }, { status: 409 });

  try {
    await refundOrder(order.id);
    return Response.json({ status: 'refunded' });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'refund failed' }, { status: 502 });
  }
}
