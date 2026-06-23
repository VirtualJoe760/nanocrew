import { and, eq, ne } from 'drizzle-orm';
import type Stripe from 'stripe';

import { db, schema } from '@/lib/db';
import { submitOrderToPrintful } from '@/lib/fulfill';
import { sendCreatorSale, sendOrderConfirmation, sendRefundConfirmation } from '@/lib/notify';
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
      const paymentIntentId = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id ?? null;
      // The charge id is the `source_transaction` for the deferred (held) transfer to the brand, so
      // capture it now. The session's PaymentIntent isn't expanded on the event, so retrieve it for
      // its latest_charge. Best-effort — a missing charge id only blocks that order's later payout.
      let chargeId: string | null = null;
      if (paymentIntentId && stripe) {
        try {
          const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
          chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id ?? null;
        } catch (e) {
          console.error('[stripe-webhook] charge lookup:', e instanceof Error ? e.message : e);
        }
      }
      const [order] = await db
        .update(schema.orders)
        .set({
          status: 'paid',
          customerEmail: s.customer_details?.email ?? 'unknown@stripe',
          stripePaymentIntentId: paymentIntentId,
          stripeChargeId: chargeId,
          subtotalCents: s.amount_subtotal ?? undefined,
          shippingCents: s.total_details?.amount_shipping ?? 0,
          taxCents: s.total_details?.amount_tax ?? 0,
          totalCents: s.amount_total ?? undefined,
          shippingAddress: collected?.shipping_details ?? s.customer_details ?? null,
        })
        // IDEMPOTENT: only transition (and return a row → submit to Printful + email buyer/creator) on
        // the FIRST time this order reaches 'paid'. A redelivered checkout.session.completed finds it
        // already 'paid', matches no row, returns nothing → no duplicate Printful order or receipt emails.
        .where(and(eq(schema.orders.stripeSessionId, s.id), ne(schema.orders.status, 'paid')))
        .returning({ id: schema.orders.id, storeId: schema.orders.storeId, customerEmail: schema.orders.customerEmail });
      // Hand the paid order to Printful (draft until PRINTFUL_CONFIRM_ORDERS=1).
      // Awaited so the serverless runtime can't kill it mid-flight; failures only
      // log — Stripe gets its 200 and the backfill script can resubmit.
      if (order) {
        await submitOrderToPrintful(order.id).catch((e) => console.error('[fulfill]', e));
        // Order confirmation (best-effort, never throws into the webhook). Discloses the returns
        // policy/window — see docs/accounts/EMAIL_PIPELINE.md #2.
        const [store] = await db
          .select({ slug: schema.stores.slug, name: schema.stores.name, creatorId: schema.stores.creatorId })
          .from(schema.stores)
          .where(eq(schema.stores.id, order.storeId))
          .limit(1);
        const items = await db
          .select({ name: schema.orderItems.nameSnapshot })
          .from(schema.orderItems)
          .where(eq(schema.orderItems.orderId, order.id));
        const itemNames = items.map((i) => i.name);
        if (store) {
          await sendOrderConfirmation({
            to: order.customerEmail,
            store,
            items: itemNames,
            order: { id: order.id, totalCents: s.amount_total ?? 0 },
          }).catch((e) => console.error('[stripe-webhook] confirmation:', e));
          // Tell the creator they made a sale (FROM Nano Crew). Best-effort, after the buyer email.
          const [creator] = await db
            .select({ email: schema.creators.email })
            .from(schema.creators)
            .where(eq(schema.creators.id, store.creatorId))
            .limit(1);
          if (creator?.email) {
            await sendCreatorSale({
              to: creator.email,
              brandName: store.name,
              items: itemNames,
              order: { id: order.id, totalCents: s.amount_total ?? 0 },
            }).catch((e) => console.error('[stripe-webhook] creator-sale:', e));
          }
        }
      }
    } else if (event.type === 'checkout.session.expired') {
      const s = event.data.object as Stripe.Checkout.Session;
      await db
        .update(schema.orders)
        .set({ status: 'cancelled' })
        .where(eq(schema.orders.stripeSessionId, s.id));
    } else if (event.type === 'charge.refunded') {
      // A refund issued here or from the Stripe dashboard — mark the order refunded once fully back.
      const c = event.data.object as Stripe.Charge;
      const pi = typeof c.payment_intent === 'string' ? c.payment_intent : c.payment_intent?.id;
      if (pi && c.amount_refunded >= c.amount) {
        const [order] = await db
          .update(schema.orders)
          .set({ status: 'refunded' })
          .where(eq(schema.orders.stripePaymentIntentId, pi))
          .returning({ id: schema.orders.id, storeId: schema.orders.storeId, customerEmail: schema.orders.customerEmail });
        // Refund confirmation — covers dashboard-initiated refunds too (the in-app/admin refund path
        // sends its own). Best-effort. See docs/accounts/EMAIL_PIPELINE.md #7.
        if (order) {
          const [store] = await db
            .select({ slug: schema.stores.slug, name: schema.stores.name })
            .from(schema.stores)
            .where(eq(schema.stores.id, order.storeId))
            .limit(1);
          if (store) {
            await sendRefundConfirmation({
              to: order.customerEmail,
              store,
              order: { id: order.id },
              amountCents: c.amount_refunded,
            }).catch((e) => console.error('[stripe-webhook] refund email:', e));
          }
        }
      }
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
