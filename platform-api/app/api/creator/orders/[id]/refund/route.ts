import { and, eq } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { corsJson, corsPreflight } from '@/lib/cors';
import { db, schema } from '@/lib/db';
import { stripe } from '@/lib/stripe';

export const OPTIONS = corsPreflight;

// POST /api/creator/orders/:id/refund — refund one of the creator's own orders. For a Connect
// (destination-charge) order this reverses the brand's transfer AND claws back the platform's
// application fee proportionally, so both parties give back their share. Ownership-checked.
const REFUNDABLE = ['paid', 'submitted_to_printful', 'in_production', 'shipped', 'delivered', 'on_hold', 'returned'];

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!stripe) return corsJson({ error: 'payments not configured' }, { status: 503 });
  const user = await getUserFromRequest(req);
  if (!user) return corsJson({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;

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
  if (!order) return corsJson({ error: 'not found' }, { status: 404 });
  if (order.status === 'refunded') return corsJson({ status: 'refunded' }); // idempotent
  if (!REFUNDABLE.includes(order.status)) return corsJson({ error: `cannot refund a ${order.status} order` }, { status: 409 });
  if (!order.paymentIntentId) return corsJson({ error: 'no payment to refund' }, { status: 409 });

  try {
    await stripe.refunds.create({
      payment_intent: order.paymentIntentId,
      // Only a destination charge has a transfer/fee to reverse; a platform-settled order is a plain refund.
      ...(order.applicationFeeCents > 0 ? { reverse_transfer: true, refund_application_fee: true } : {}),
    });
    await db.update(schema.orders).set({ status: 'refunded' }).where(eq(schema.orders.id, order.id));
    return corsJson({ status: 'refunded' });
  } catch (e) {
    return corsJson({ error: e instanceof Error ? e.message : 'refund failed' }, { status: 502 });
  }
}
