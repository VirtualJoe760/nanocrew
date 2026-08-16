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
      payoutTransferId: schema.orders.payoutTransferId,
    })
    .from(schema.orders)
    .innerJoin(schema.stores, eq(schema.stores.id, schema.orders.storeId))
    .where(and(eq(schema.orders.id, id), eq(schema.stores.creatorId, user.id)))
    .limit(1);
  if (!order) return corsJson({ error: 'not found' }, { status: 404 });
  if (order.status === 'refunded') return corsJson({ status: 'refunded' }); // idempotent
  if (!REFUNDABLE.includes(order.status)) return corsJson({ error: `cannot refund a ${order.status} order` }, { status: 409 });
  if (!order.paymentIntentId) return corsJson({ error: 'no payment to refund' }, { status: 409 });

  // SEPARATE CHARGES + TRANSFERS — the charge has NO attached transfer, so `reverse_transfer` on the
  // refund is dead wrong here (Stripe rejects it: "charge has no associated transfer"). This route
  // used to do exactly that — destination-charge semantics left over from the old model — which made
  // released orders unrefundable from a brand site's /admin, and would never have clawed back the
  // brand's money. An already-sent transfer is reversed EXPLICITLY, by id.
  //
  // Idempotency keys match the app path (src/lib/connect.ts refundOrder: `refund_${id}` /
  // `reverse_${id}`) on purpose — a refund attempted from both surfaces dedupes at Stripe instead of
  // double-moving money.
  const nextPayoutStatus =
    order.payoutStatus === 'released' ? 'reversed' : order.payoutStatus === 'held' ? 'skipped' : order.payoutStatus;
  try {
    await stripe.refunds.create(
      { payment_intent: order.paymentIntentId },
      { idempotencyKey: `refund_${order.id}` },
    );
    if (order.payoutStatus === 'released' && order.payoutTransferId) {
      // The brand was already paid — claw the net back. If THIS fails (e.g. the creator's balance
      // was already paid out), the buyer is still refunded; we return 502 and leave payoutStatus
      // untouched so the un-reversed transfer stays visible instead of being recorded as reversed.
      await stripe.transfers.createReversal(
        order.payoutTransferId,
        {},
        { idempotencyKey: `reverse_${order.id}` },
      );
    }
    await db.update(schema.orders).set({ status: 'refunded', payoutStatus: nextPayoutStatus }).where(eq(schema.orders.id, order.id));
    return corsJson({ status: 'refunded' });
  } catch (e) {
    return corsJson({ error: e instanceof Error ? e.message : 'refund failed' }, { status: 502 });
  }
}
