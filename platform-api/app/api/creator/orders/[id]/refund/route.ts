import { and, eq } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { corsJson, corsPreflight } from '@/lib/cors';
import { db, schema } from '@/lib/db';
import { stripe } from '@/lib/stripe';

export const OPTIONS = corsPreflight;

// POST /api/creator/orders/:id/refund — refund one of the creator's own orders (the brand-site
// /admin twin of the app route). Under the held-marketplace model the money movement branches on
// payoutStatus: 'held' → the brand was never paid, so just cancel the un-sent transfer (mark
// 'skipped') and refund the buyer with NO reverse_transfer; 'released' → reverse the already-sent
// transfer ('reversed'); 'none' → a plain platform refund. Ownership-checked. Mirrors the app route
// (src/app/api/creator/orders/[id]/refund+api.ts) + docs/accounts/RETURNS_REFUNDS.md.
const REFUNDABLE = ['paid', 'submitted_to_printful', 'in_production', 'shipped', 'delivered', 'on_hold', 'returned', 'return_requested'];

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
      payoutStatus: schema.orders.payoutStatus,
    })
    .from(schema.orders)
    .innerJoin(schema.stores, eq(schema.stores.id, schema.orders.storeId))
    .where(and(eq(schema.orders.id, id), eq(schema.stores.creatorId, user.id)))
    .limit(1);
  if (!order) return corsJson({ error: 'not found' }, { status: 404 });
  if (order.status === 'refunded') return corsJson({ status: 'refunded' }); // idempotent
  if (!REFUNDABLE.includes(order.status)) return corsJson({ error: `cannot refund a ${order.status} order` }, { status: 409 });
  if (!order.paymentIntentId) return corsJson({ error: 'no payment to refund' }, { status: 409 });

  // Only an already-released Connect transfer needs reversing; a held order's transfer was never sent.
  const reverseTransfer = order.payoutStatus === 'released';
  const nextPayoutStatus =
    order.payoutStatus === 'released' ? 'reversed' : order.payoutStatus === 'held' ? 'skipped' : order.payoutStatus;
  try {
    await stripe.refunds.create({
      payment_intent: order.paymentIntentId,
      ...(reverseTransfer ? { reverse_transfer: true, refund_application_fee: true } : {}),
    });
    await db.update(schema.orders).set({ status: 'refunded', payoutStatus: nextPayoutStatus }).where(eq(schema.orders.id, order.id));
    return corsJson({ status: 'refunded' });
  } catch (e) {
    return corsJson({ error: e instanceof Error ? e.message : 'refund failed' }, { status: 502 });
  }
}
