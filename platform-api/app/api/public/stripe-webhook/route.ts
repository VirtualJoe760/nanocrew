import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';

import { db, schema } from '@/lib/db';
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
      await db
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
        .where(eq(schema.orders.stripeSessionId, s.id));
    } else if (event.type === 'checkout.session.expired') {
      const s = event.data.object as Stripe.Checkout.Session;
      await db
        .update(schema.orders)
        .set({ status: 'cancelled' })
        .where(eq(schema.orders.stripeSessionId, s.id));
    }
    return Response.json({ received: true });
  } catch (e) {
    console.error('[stripe-webhook]', e instanceof Error ? e.message : e);
    return Response.json({ error: 'handler failed' }, { status: 500 });
  }
}
