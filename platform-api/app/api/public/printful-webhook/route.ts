import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { sendShippedEmail } from '@/lib/notify';

// POST /api/public/printful-webhook — Printful order lifecycle events.
// package_shipped → tracking + status shipped + customer email.
// order_canceled / order_failed → status cancelled.
// v1 webhooks are unsigned; we require the store id to match and resolve orders
// only by our own printful_order_id reference.

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
      await db
        .update(schema.orders)
        .set({
          status: 'shipped',
          trackingNumber: ship.tracking_number ?? null,
          trackingUrl: ship.tracking_url ?? null,
        })
        .where(eq(schema.orders.id, order.id));

      const [store] = await db
        .select({ name: schema.stores.name })
        .from(schema.stores)
        .where(eq(schema.stores.id, order.storeId))
        .limit(1);
      const items = await db
        .select({ name: schema.orderItems.nameSnapshot })
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, order.id));
      await sendShippedEmail({
        to: order.customerEmail,
        brandName: store?.name ?? 'your brand',
        items: items.map((i) => i.name),
        trackingNumber: ship.tracking_number,
        trackingUrl: ship.tracking_url,
      }).catch((e) => console.error('[printful-webhook] notify:', e));
    } else if (event.type === 'order_canceled' || event.type === 'order_failed') {
      await db.update(schema.orders).set({ status: 'cancelled' }).where(eq(schema.orders.id, order.id));
      console.warn(`[printful-webhook] ${order.id} ${event.type}: ${event.data.reason ?? ''}`);
    }
    return Response.json({ ok: true });
  } catch (e) {
    console.error('[printful-webhook]', e instanceof Error ? e.message : e);
    return Response.json({ ok: false }, { status: 500 });
  }
}
