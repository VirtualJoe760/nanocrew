import { timingSafeEqual } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { sendDeliveredReviewRequest, sendShippedEmail } from '@/lib/notify';

// DELIVERED / REVIEW-REQUEST EMAIL — design note (docs/accounts/EMAIL_PIPELINE.md #4):
// Printful (v1) emits no carrier "delivered" event, so there is no real delivery signal to hook.
// Email lives ONLY in platform-api (Resend), but the persistent shippedAt+N timer (the natural
// "presumed delivered, window closed" moment) is the app-side release-payouts job, which can't
// import this Resend module. Rather than invent a cross-service email contract, v1 fires the
// review request from THIS webhook on `package_shipped` — the closest available signal — with copy
// scoped to "leave a review once it arrives." A true delivery trigger waits on carrier tracking
// integration (follow-up); when that lands, move this send to the delivered branch.

// POST /api/public/printful-webhook — Printful order lifecycle events, mapped to our order_status:
//   package_shipped  → shipped (+ tracking + customer email)
//   package_returned → returned (the package came back; the creator may then refund in Stripe)
//   order_put_hold   → on_hold      ·  order_remove_hold → in_production (resumed)
//   order_failed     → failed       ·  order_canceled    → cancelled
//   order_refunded   → logged only — Printful refunds US (our fulfillment cost), it does NOT refund
//                      the shopper, whose money is in Stripe; the customer order stays as-is.
// v1 webhooks are unsigned, so we add our own shared-secret gate: set PRINTFUL_WEBHOOK_TOKEN and
// register the webhook URL in Printful with a matching `?token=<value>` query string. When the env
// is set the token is required (constant-time compared); when unset we fall back to the store-id
// check only (backward-compatible). Orders are resolved solely by our own printful_order_id.

type PrintfulEvent = {
  type?: string;
  store?: number;
  data?: {
    shipment?: { tracking_number?: string; tracking_url?: string; carrier?: string };
    order?: { id?: number; external_id?: string };
    reason?: string;
  };
};

export async function POST(req: Request) {
  try {
    // Shared-secret gate (opt-in): if PRINTFUL_WEBHOOK_TOKEN is set, the caller must present a
    // matching ?token=. Prevents forged status flips (a guessable store id was the only barrier).
    const secret = process.env.PRINTFUL_WEBHOOK_TOKEN;
    if (secret) {
      const got = new URL(req.url).searchParams.get('token') ?? '';
      const a = Buffer.from(got);
      const b = Buffer.from(secret);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return Response.json({ ok: false }, { status: 401 });
      }
    }

    const event = (await req.json().catch(() => null)) as PrintfulEvent | null;
    const expectedStore = process.env.PRINTFUL_STORE_ID;
    if (!event?.type || !event.data?.order?.id) return Response.json({ ok: false }, { status: 400 });
    if (expectedStore && String(event.store ?? '') !== expectedStore) {
      return Response.json({ ok: false }, { status: 403 });
    }

    const pfId = String(event.data.order.id);
    const [order] = await db
      .select({
        id: schema.orders.id,
        customerEmail: schema.orders.customerEmail,
        storeId: schema.orders.storeId,
        status: schema.orders.status,
      })
      .from(schema.orders)
      .where(eq(schema.orders.printfulOrderId, pfId))
      .limit(1);
    if (!order) return Response.json({ ok: true, note: 'unknown order' });

    if (event.type === 'package_shipped') {
      const ship = event.data.shipment ?? {};
      // Stamp the ship date and derive the return window + payout-release date from it. The 7-day
      // clock is anchored on shippedAt (no carrier-delivery integration in v1); RETURN_WINDOW_DAYS
      // is the single knob. returnWindowEndsAt = payoutReleaseAt = shippedAt + window. See
      // docs/accounts/RETURNS_REFUNDS.md (payout hold).
      const RETURN_WINDOW_DAYS = Number(process.env.RETURN_WINDOW_DAYS ?? 7);
      const shippedAt = new Date();
      const windowEnd = new Date(shippedAt.getTime() + RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      await db
        .update(schema.orders)
        .set({
          status: 'shipped',
          trackingNumber: ship.tracking_number ?? null,
          trackingUrl: ship.tracking_url ?? null,
          shippedAt,
          returnWindowEndsAt: windowEnd,
          payoutReleaseAt: windowEnd,
        })
        .where(eq(schema.orders.id, order.id));

      const [store] = await db
        .select({ slug: schema.stores.slug, name: schema.stores.name })
        .from(schema.stores)
        .where(eq(schema.stores.id, order.storeId))
        .limit(1);
      const items = await db
        .select({ name: schema.orderItems.nameSnapshot })
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, order.id));
      if (store) {
        await sendShippedEmail({
          to: order.customerEmail,
          store,
          items: items.map((i) => i.name),
          trackingNumber: ship.tracking_number,
          trackingUrl: ship.tracking_url,
        }).catch((e) => console.error('[printful-webhook] notify:', e));
        // Review request — v1 proxy fired here (no carrier delivered event; see the design note up
        // top). Best-effort; never throws into the webhook 200.
        await sendDeliveredReviewRequest({
          to: order.customerEmail,
          store,
          order: { id: order.id },
        }).catch((e) => console.error('[printful-webhook] review notify:', e));
      }
    } else if (event.type === 'package_returned') {
      // The package came back to sender. Track it so the creator sees it and can issue a Stripe refund.
      await db.update(schema.orders).set({ status: 'returned' }).where(eq(schema.orders.id, order.id));
      console.warn(`[printful-webhook] ${order.id} returned: ${event.data.reason ?? ''}`);
    } else if (event.type === 'order_put_hold') {
      await db.update(schema.orders).set({ status: 'on_hold' }).where(eq(schema.orders.id, order.id));
      console.warn(`[printful-webhook] ${order.id} on hold: ${event.data.reason ?? ''}`);
    } else if (event.type === 'order_remove_hold') {
      // Resumed — only lift the hold if we haven't already moved past it (shipped/returned/etc.).
      if (order.status === 'on_hold') {
        await db.update(schema.orders).set({ status: 'in_production' }).where(eq(schema.orders.id, order.id));
      }
    } else if (event.type === 'order_failed') {
      await db.update(schema.orders).set({ status: 'failed' }).where(eq(schema.orders.id, order.id));
      console.warn(`[printful-webhook] ${order.id} failed: ${event.data.reason ?? ''}`);
    } else if (event.type === 'order_canceled') {
      await db.update(schema.orders).set({ status: 'cancelled' }).where(eq(schema.orders.id, order.id));
      console.warn(`[printful-webhook] ${order.id} canceled: ${event.data.reason ?? ''}`);
    } else if (event.type === 'order_refunded') {
      // Printful refunded our fulfillment cost — does NOT refund the shopper (Stripe holds their
      // money). Track for reconciliation only; the customer order status is unchanged.
      console.warn(`[printful-webhook] ${order.id} printful-refunded (merchant-side): ${event.data.reason ?? ''}`);
    }
    return Response.json({ ok: true });
  } catch (e) {
    console.error('[printful-webhook]', e instanceof Error ? e.message : e);
    return Response.json({ ok: false }, { status: 500 });
  }
}
