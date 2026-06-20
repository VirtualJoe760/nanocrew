import { eq } from 'drizzle-orm';

import { corsJson, corsPreflight } from '@/lib/cors';
import { db, schema } from '@/lib/db';

export const OPTIONS = corsPreflight;

// POST /api/public/order-lookup { email, orderNumber }
// → a minimal order view for the GUEST return flow (no auth — gated by email + order id match).
// Orders have no human "order number" scheme, so `orderNumber` is the order id (UUID) the buyer
// has from their confirmation. We match it together with the email (case-insensitive) so knowing
// just an id isn't enough to read someone else's order. Mirrors checkout/route.ts conventions
// (corsJson/corsPreflight, JSON-body validation, db from '@/lib/db').
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      email?: string;
      orderNumber?: string;
    } | null;
    const email = body?.email?.trim().toLowerCase();
    const orderNumber = body?.orderNumber?.trim();
    if (!email || !orderNumber) return corsJson({ error: 'email and orderNumber required' }, { status: 400 });

    // UUID guard — a non-uuid `orderNumber` would make Postgres throw on the eq() cast.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderNumber)) {
      return corsJson({ error: 'order not found' }, { status: 404 });
    }

    const [order] = await db
      .select({
        id: schema.orders.id,
        status: schema.orders.status,
        customerEmail: schema.orders.customerEmail,
        trackingUrl: schema.orders.trackingUrl,
        trackingNumber: schema.orders.trackingNumber,
        returnWindowEndsAt: schema.orders.returnWindowEndsAt,
      })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderNumber))
      .limit(1);
    // Same 404 whether the id is wrong or the email doesn't match — don't leak which orders exist.
    if (!order || order.customerEmail.trim().toLowerCase() !== email) {
      return corsJson({ error: 'order not found' }, { status: 404 });
    }

    const items = await db
      .select({
        name: schema.orderItems.nameSnapshot,
        variant: schema.orderItems.variantSnapshot,
        quantity: schema.orderItems.quantity,
      })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, order.id));

    const inWindow = !!order.returnWindowEndsAt && Date.now() < order.returnWindowEndsAt.getTime();

    return corsJson({
      order: {
        id: order.id,
        status: order.status,
        items,
        trackingUrl: order.trackingUrl,
        trackingNumber: order.trackingNumber,
        returnWindowEndsAt: order.returnWindowEndsAt,
        inWindow,
      },
    });
  } catch (e) {
    console.error('[order-lookup]', e instanceof Error ? e.message : e);
    return corsJson({ error: 'lookup failed' }, { status: 500 });
  }
}
