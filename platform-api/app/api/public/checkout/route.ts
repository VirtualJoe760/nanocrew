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
      .select({ id: schema.stores.id, slug: schema.stores.slug, name: schema.stores.name, deploymentUrl: schema.stores.deploymentUrl, creatorId: schema.stores.creatorId })
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
        printfulCostCents: schema.variants.printfulCostCents,
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
      // Pricing integrity: never send an unpriced item to Stripe (it would either be free or rejected
      // below Stripe's $0.50 minimum). Products are floored at publish, so this is a safety net.
      if (!v.retailPriceCents || v.retailPriceCents < 50) {
        return corsJson({ error: `${v.productName} isn’t available for purchase right now.` }, { status: 409 });
      }
      lineItems.push({ variant: v, quantity: Math.min(i.quantity, 20) });
    }
    const subtotalCents = lineItems.reduce((n, l) => n + l.variant.retailPriceCents * l.quantity, 0);
    const shippingCents = Number(process.env.SHIPPING_FLAT_CENTS ?? 799);

    // Processing fee passed to the customer (offsets our card-processing cost), WAIVED once they
    // spend the threshold (default $200). Grossed up — the fee line is itself processed — so it
    // self-covers: fee = (pct·base + flat) / (1 − pct). The platform keeps it (see app fee below).
    const FEE_PCT = Number(process.env.PROCESSING_FEE_PCT ?? 0.029);
    const FEE_FLAT_CENTS = Number(process.env.PROCESSING_FEE_FLAT_CENTS ?? 30);
    const FEE_WAIVE_CENTS = Number(process.env.PROCESSING_FEE_WAIVE_CENTS ?? 20000); // $200
    const processingFeeCents =
      subtotalCents >= FEE_WAIVE_CENTS
        ? 0
        : Math.round((FEE_PCT * (subtotalCents + shippingCents) + FEE_FLAT_CENTS) / (1 - FEE_PCT));

    // Stripe Connect (Phase D) — SEPARATE CHARGES AND TRANSFERS (the held-marketplace pattern).
    // If this brand's creator has a charges-enabled connected account we capture 100% of the charge
    // to the PLATFORM (no destination charge, no application fee), compute the brand's exact net the
    // same way as before, and persist it as HELD on the order. The brand is only paid later, by the
    // release job, once the return window closes with no open claim (see docs/accounts/RETURNS_REFUNDS.md).
    // When no charges-enabled account exists, checkout settles to the platform exactly as before
    // (payoutStatus 'none', brandNetCents 0 — nothing to transfer). Inert until Connect is set up.
    const COMMISSION_PCT = Number(process.env.PLATFORM_COMMISSION_PCT ?? 0.1);
    const COGS_FALLBACK_PCT = Number(process.env.DEFAULT_COGS_PCT ?? 0.5); // when a variant's Printful cost is unknown
    const [connected] = await db
      .select({ stripeAccountId: schema.connectedAccounts.stripeAccountId, chargesEnabled: schema.connectedAccounts.chargesEnabled })
      .from(schema.connectedAccounts)
      .where(eq(schema.connectedAccounts.creatorId, store.creatorId))
      .limit(1);

    const totalCents = subtotalCents + shippingCents + processingFeeCents;
    let applicationFeeCents = 0;
    // The deferred payout fields, persisted on the order row (default = platform-settled / 'none').
    let payoutStatus: 'none' | 'held' = 'none';
    let brandNetCents = 0;
    let connectedAccountId: string | null = null;
    if (connected?.stripeAccountId && connected.chargesEnabled) {
      const cogsCents = lineItems.reduce(
        (n, l) => n + (l.variant.printfulCostCents ?? Math.round(l.variant.retailPriceCents * COGS_FALLBACK_PCT)) * l.quantity,
        0,
      );
      const commissionCents = Math.round(subtotalCents * COMMISSION_PCT);
      // Platform keeps COGS + shipping + commission + the processing fee; the brand gets the
      // remainder (its profit) — the processing fee never eats into the brand's cut. Same math as the
      // old destination charge; now used to compute the HELD transfer rather than an application fee.
      applicationFeeCents = Math.min(totalCents, cogsCents + shippingCents + commissionCents + processingFeeCents);
      brandNetCents = totalCents - applicationFeeCents;
      connectedAccountId = connected.stripeAccountId;
      payoutStatus = 'held';
    }
    // NOTE: no payment_intent_data — the charge is captured 100% to the platform. The brand's net is
    // transferred later by /api/internal/release-payouts via src/lib/connect.ts releasePayout().

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
        applicationFeeCents,
        // Deferred payout (separate charges + transfers). The brand's net is held on the platform
        // until the release job runs; the webhook fills stripeChargeId (the transfer source).
        payoutStatus,
        brandNetCents,
        connectedAccountId,
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
      line_items: [
        ...lineItems.map((l) => ({
          quantity: l.quantity,
          price_data: {
            currency: 'usd' as const,
            unit_amount: l.variant.retailPriceCents,
            product_data: {
              name: `${l.variant.productName}${l.variant.size ? ` — ${[l.variant.color, l.variant.size].filter(Boolean).join(' / ')}` : ''}`,
              ...(l.variant.productImage ? { images: [l.variant.productImage] } : {}),
            },
          },
        })),
        // Processing fee (waived at the spend threshold) — a single flat line the customer sees.
        ...(processingFeeCents > 0
          ? [{ quantity: 1, price_data: { currency: 'usd' as const, unit_amount: processingFeeCents, product_data: { name: 'Processing fee' } } }]
          : []),
      ],
      shipping_address_collection: { allowed_countries: ['US', 'CA'] },
      // Flat-rate shipping so Printful's fulfillment shipping isn't eaten by margin.
      // SHIPPING_FLAT_CENTS env overrides; Printful US apparel runs ~$4.70-$8.50.
      shipping_options: [
        {
          shipping_rate_data: {
            display_name: 'Standard shipping',
            type: 'fixed_amount',
            fixed_amount: { amount: shippingCents, currency: 'usd' },
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 5 },
              maximum: { unit: 'business_day', value: 10 },
            },
          },
        },
      ],
      metadata: { orderId: order.id, storeSlug: store.slug, storeName: store.name },
      // No payment_intent_data: the charge settles 100% to the platform. The brand's held net is
      // transferred later by the release job — see the payout fields persisted on the order above.
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
