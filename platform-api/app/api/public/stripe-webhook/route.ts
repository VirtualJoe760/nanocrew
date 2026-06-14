import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';

import { db, schema } from '@/lib/db';
import { submitOrderToPrintful } from '@/lib/fulfill';
import { stripe, WEBHOOK_SECRET } from '@/lib/stripe';

// POST /api/public/stripe-webhook — Stripe events (no CORS: server-to-server).
// checkout.session.completed flips the pending order to paid and records the
// customer + shipping details. Printful submission hangs off the paid order
// (next phase — order_status already models the whole lifecycle).
export async function POST(req: Request) {
  if (!stripe || !WEBHOOK_SECRET) return Response.json({ error: 'not configured' }, { status: 503 });

  let event: Stripe.Event;
  try {
    const sig = req.headers.get('stripe-signature') ?? '';
    event = await stripe.webhooks.constructEventAsync(await req.text(), sig, WEBHOOK_SECRET);
  } catch {
    return Response.json({ error: 'bad signature' }, { status: 400 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object as Stripe.Checkout.Session;
      const collected = (s as { collected_information?: { shipping_details?: unknown } }).collected_information;
      const [order] = await db
        .update(schema.orders)
        .set({
          status: 'paid',
          customerEmail: s.customer_details?.email ?? 'unknown@stripe',
          stripePaymentIntentId: typeof s.payment_intent === 'string' ? s.payment_intent : null,
          subtotalCents: s.amount_subtotal ?? undefined,
          shippingCents: s.total_details?.amount_shipping ?? 0,
          taxCents: s.total_details?.amount_tax ?? 0,
          totalCents: s.amount_total ?? undefined,
          shippingAddress: collected?.shipping_details ?? s.customer_details ?? null,
        })
        .where(eq(schema.orders.stripeSessionId, s.id))
        .returning({ id: schema.orders.id });
      // Hand the paid order to Printful (draft until PRINTFUL_CONFIRM_ORDERS=1).
      // Awaited so the serverless runtime can't kill it mid-flight; failures only
      // log — Stripe gets its 200 and the backfill script can resubmit.
      if (order) await submitOrderToPrintful(order.id).catch((e) => console.error('[fulfill]', e));
    } else if (event.type === 'checkout.session.expired') {
      const s = event.data.object as Stripe.Checkout.Session;
      await db
        .update(schema.orders)
        .set({ status: 'cancelled' })
        .where(eq(schema.orders.stripeSessionId, s.id));
    } else if (event.type === 'account.updated') {
      // Connect (Phase D): a creator's Express account changed — sync its capability flags so the
      // app's go-live gate and checkout routing see the live state.
      const a = event.data.object as Stripe.Account;
      await db
        .update(schema.connectedAccounts)
        .set({
          chargesEnabled: !!a.charges_enabled,
          payoutsEnabled: !!a.payouts_enabled,
          detailsSubmitted: !!a.details_submitted,
        })
        .where(eq(schema.connectedAccounts.stripeAccountId, a.id));
    }
    return Response.json({ received: true });
  } catch (e) {
    console.error('[stripe-webhook]', e instanceof Error ? e.message : e);
    return Response.json({ error: 'handler failed' }, { status: 500 });
  }
}
