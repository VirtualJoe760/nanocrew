import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// Submit a paid order to Printful. SAFETY: orders are created as DRAFTS unless
// PRINTFUL_CONFIRM_ORDERS=1 — drafts cost nothing and print nothing, so test
// checkouts never produce real merch. Flip the env var at launch.

type StripeAddress = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
};
type ShippingJson = {
  name?: string | null;
  address?: StripeAddress | null;
} | null;

export async function submitOrderToPrintful(orderId: string): Promise<void> {
  const apiKey = process.env.PRINTFUL_API_KEY;
  const storeId = process.env.PRINTFUL_STORE_ID;
  if (!apiKey) {
    console.log('[fulfill] skipped — PRINTFUL_API_KEY not set');
    return;
  }

  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!order || order.status !== 'paid' || order.printfulOrderId) return;

  const items = await db
    .select({
      quantity: schema.orderItems.quantity,
      syncVariantId: schema.variants.printfulSyncVariantId,
      name: schema.orderItems.nameSnapshot,
    })
    .from(schema.orderItems)
    .innerJoin(schema.variants, eq(schema.variants.id, schema.orderItems.variantId))
    .where(eq(schema.orderItems.orderId, orderId));
  const usable = items.filter((i) => i.syncVariantId);
  if (!usable.length) {
    console.error(`[fulfill] ${orderId}: no items with printful sync variants`);
    return;
  }

  const ship = order.shippingAddress as ShippingJson;
  const addr = ship?.address;
  if (!addr?.line1 || !addr.city || !addr.country) {
    console.error(`[fulfill] ${orderId}: incomplete shipping address`);
    return;
  }

  const confirm = process.env.PRINTFUL_CONFIRM_ORDERS === '1';
  const res = await fetch(`https://api.printful.com/orders?confirm=${confirm ? 1 : 0}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(storeId ? { 'X-PF-Store-Id': storeId } : {}),
    },
    body: JSON.stringify({
      // Printful caps external_id at 32 chars — a dashless UUID is exactly 32.
      external_id: orderId.replace(/-/g, ''),
      recipient: {
        name: ship?.name ?? 'Customer',
        email: order.customerEmail,
        address1: addr.line1,
        address2: addr.line2 ?? undefined,
        city: addr.city,
        state_code: addr.state ?? undefined,
        country_code: addr.country,
        zip: addr.postal_code ?? undefined,
      },
      items: usable.map((i) => ({ sync_variant_id: Number(i.syncVariantId), quantity: i.quantity })),
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    result?: { id?: number; status?: string };
    error?: { message?: string };
  };
  if (!res.ok || !json.result?.id) {
    console.error(`[fulfill] ${orderId}: printful order failed — ${json.error?.message ?? res.status}`);
    return;
  }

  await db
    .update(schema.orders)
    .set({ printfulOrderId: String(json.result.id), status: 'submitted_to_printful' })
    .where(eq(schema.orders.id, orderId));
  console.log(`[fulfill] ${orderId} → printful ${json.result.id} (${json.result.status})`);
}
