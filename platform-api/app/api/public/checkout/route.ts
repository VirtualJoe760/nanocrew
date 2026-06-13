import { eq, inArray } from 'drizzle-orm';

import { corsJson, corsPreflight } from '@/lib/cors';
import { db, schema } from '@/lib/db';
import { stripe } from '@/lib/stripe';

export const OPTIONS = corsPreflight;

// POST /api/public/checkout { storeSlug, items: [{ variantId, quantity }] }
// → Stripe Checkout URL. Prices come from the DB — the client is never trusted.
// The order row is created up front as pending_payment; the webhook flips it to
// paid and fills customer/shipping details.
export async function POST(req: Request) {
  if (!stripe) return corsJson({ error: 'Checkout is not configured yet' }, { status: 503 });
  try {
    const body = (await req.json().catch(() => null)) as {
      storeSlug?: string;
      items?: { variantId: string; quantity: number }[];
    } | null;
    const items = (body?.items ?? []).filter((i) => i.variantId && i.quantity > 0).slice(0, 50);
    if (!body?.storeSlug || !items.length) return corsJson({ error: 'storeSlug and items required' }, { status: 400 });

    const [store] = await db
      .select({ id: schema.stores.id, slug: schema.stores.slug, name: schema.stores.name, deploymentUrl: schema.stores.deploymentUrl })
      .from(schema.stores)
      .where(eq(schema.stores.slug, body.storeSlug))
      .limit(1);
    if (!store) return corsJson({ error: 'store not found' }, { status: 404 });

    const rows = await db
      .select({
        id: schema.variants.id,
        color: schema.variants.color,
        size: schema.variants.size,
        retailPriceCents: schema.variants.retailPriceCents,
        inStock: schema.variants.inStock,
        productName: schema.products.name,
        productImage: schema.products.imageUrl,
        productStoreId: schema.products.storeId,
      })
      .from(schema.variants)
      .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
      .where(inArray(schema.variants.id, items.map((i) => i.variantId)));

    const lineItems: { variant: (typeof rows)[number]; quantity: number }[] = [];
    for (const i of items) {
      const v = rows.find((r) => r.id === i.variantId);
      if (!v || v.productStoreId !== store.id) return corsJson({ error: 'unknown item in cart' }, { status: 400 });
      if (!v.inStock) return corsJson({ error: `${v.productName} (${v.size}) is out of stock` }, { status: 409 });
      lineItems.push({ variant: v, quantity: Math.min(i.quantity, 20) });
    }
    const subtotalCents = lineItems.reduce((n, l) => n + l.variant.retailPriceCents * l.quantity, 0);

    // The brand site we send the shopper back to.
    const origin = req.headers.get('origin') ?? store.deploymentUrl ?? `https://store-${store.slug}.vercel.app`;

    const [order] = await db
      .insert(schema.orders)
      .values({
        storeId: store.id,
        customerEmail: 'pending@checkout', // real email arrives via the webhook
        status: 'pending_payment',
        subtotalCents,
        totalCents: subtotalCents,
      })
      .returning({ id: schema.orders.id });
    await db.insert(schema.orderItems).values(
      lineItems.map((l) => ({
        orderId: order.id,
        variantId: l.variant.id,
        quantity: l.quantity,
        unitPriceCents: l.variant.retailPriceCents,
        nameSnapshot: l.variant.productName,
        variantSnapshot: [l.variant.color, l.variant.size].filter(Boolean).join(' / '),
      })),
    );

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems.map((l) => ({
        quantity: l.quantity,
        price_data: {
          currency: 'usd',
          unit_amount: l.variant.retailPriceCents,
          product_data: {
            name: `${l.variant.productName}${l.variant.size ? ` — ${[l.variant.color, l.variant.size].filter(Boolean).join(' / ')}` : ''}`,
            ...(l.variant.productImage ? { images: [l.variant.productImage] } : {}),
          },
        },
      })),
      shipping_address_collection: { allowed_countries: ['US', 'CA'] },
      metadata: { orderId: order.id, storeSlug: store.slug, storeName: store.name },
      success_url: `${origin}/cart?checkout=success`,
      cancel_url: `${origin}/cart?checkout=cancelled`,
    });

    await db.update(schema.orders).set({ stripeSessionId: session.id }).where(eq(schema.orders.id, order.id));
    return corsJson({ url: session.url });
  } catch (e) {
    console.error('[checkout]', e instanceof Error ? e.message : e);
    return corsJson({ error: 'checkout failed' }, { status: 500 });
  }
}
