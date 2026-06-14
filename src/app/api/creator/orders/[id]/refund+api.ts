import { and, eq } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { refundPayment } from '@/lib/connect';

// POST /api/creator/orders/:id/refund — refund one of the creator's own orders from the app
// (parity with the brand-site /admin). Full refund; for a Connect order it reverses the brand's
// transfer + the platform fee. Ownership-checked. Mirrors the platform-api route.
const REFUNDABLE = ['paid', 'submitted_to_printful', 'in_production', 'shipped', 'delivered', 'on_hold', 'returned'];

export async function POST(req: Request, { id }: Record<string, string>) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const [order] = await db
    .select({
      id: schema.orders.id,
      status: schema.orders.status,
      paymentIntentId: schema.orders.stripePaymentIntentId,
      applicationFeeCents: schema.orders.applicationFeeCents,
    })
    .from(schema.orders)
    .innerJoin(schema.stores, eq(schema.stores.id, schema.orders.storeId))
    .where(and(eq(schema.orders.id, id), eq(schema.stores.creatorId, user.id)))
    .limit(1);
  if (!order) return Response.json({ error: 'not found' }, { status: 404 });
  if (order.status === 'refunded') return Response.json({ status: 'refunded' }); // idempotent
  if (!REFUNDABLE.includes(order.status)) return Response.json({ error: `cannot refund a ${order.status} order` }, { status: 409 });
  if (!order.paymentIntentId) return Response.json({ error: 'no payment to refund' }, { status: 409 });

  try {
    await refundPayment(order.paymentIntentId, { reverseTransfer: order.applicationFeeCents > 0 });
    await db.update(schema.orders).set({ status: 'refunded' }).where(eq(schema.orders.id, order.id));
    return Response.json({ status: 'refunded' });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'refund failed' }, { status: 502 });
  }
}
