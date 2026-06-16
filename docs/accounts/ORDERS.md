# Orders & the commerce identity

Who an order belongs to, and how the creator and (eventually) the shopper see it. The headline:
**an order is keyed to a customer by email only — there is no user FK.** Read this before
touching checkout, the order webhook, or any "orders" surface.

## An order has no account — just an email · `src/db/schema.ts`

```ts
export const orders = pgTable('orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').notNull().references(() => stores.id, …),  // which brand
  customerEmail: text('customer_email').notNull(),                      // ◄── the ONLY customer key
  stripeSessionId: text('stripe_session_id').unique(),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  printfulOrderId: text('printful_order_id'),
  status: orderStatus('status').notNull().default('pending_payment'),
  // …subtotal/shipping/tax/total/applicationFee cents, shippingAddress, tracking…
});
```

There is **no `userId` / `creatorId` column on `orders`**. A customer is identified purely by
`customerEmail`. `orderItems` snapshots name + variant text at purchase time
(`nameSnapshot`, `variantSnapshot`) and keeps a nullable `variantId` (`onDelete: 'set null'`)
so deleting a product later doesn't orphan history.

This is the single fact the rest of this doc — and the target shopper view — hangs on.

## How an order is born — checkout · `platform-api/app/api/public/checkout/route.ts`

`POST /api/public/checkout { storeSlug, items: [{ variantId, quantity }] }` → `{ url }`. The
shared POS (see [STOREFRONT_DATA_CONTRACT.md](../storefront/STOREFRONT_DATA_CONTRACT.md)):

1. Prices are re-read from the DB — the client cart is never trusted; out-of-stock and
   sub-$0.50 variants are rejected.
2. An order row is inserted **`pending_payment`** with a **placeholder
   `customerEmail: 'pending@checkout'`** — because at this point we don't know who the buyer is
   yet. The real identity comes from Stripe.
3. A Stripe Checkout Session is created (with a processing fee line + flat shipping, and — if the
   brand's creator has a charges-enabled Connect account — destination-charge routing with an
   application fee; see [BILLING_CREDITS.md](BILLING_CREDITS.md)). `metadata.orderId` ties the
   session back to the row.

The in-app store proxies this via `/api/store/[slug]/checkout`; storefront templates POST it
directly. Either way the customer's identity is whatever they type into **Stripe Checkout**, not
a Nano Crew login.

## How the email gets filled — the webhook · `platform-api/app/api/public/stripe-webhook/route.ts`

On `checkout.session.completed`, the webhook flips the order to **`paid`** and fills the real
customer details from Stripe:

```ts
customerEmail: s.customer_details?.email ?? 'unknown@stripe',
stripePaymentIntentId: …,
shippingAddress: collected?.shipping_details ?? s.customer_details ?? null,
```

So `customerEmail` is **populated from Stripe**, not from any Nano Crew session. It then submits
the paid order to Printful (`submitOrderToPrintful`). Other events: `checkout.session.expired` →
`cancelled`; `charge.refunded` (full) → `refunded`. Further fulfilment transitions
(`shipped`, `delivered`, `on_hold`, `returned`, `failed`) come from the Printful webhook.

## How the CREATOR sees orders — authed + store-scoped

A creator views the orders **for the stores they own or collaborate on**, never by buyer
identity. Two parallel implementations (same shape), because the app and the brand-site `/admin`
hit different backends:

- **App** — `src/app/api/creator/orders+api.ts` (`GET /api/creator/orders`): recent orders
  across `accessibleStoreIds(user.id)`, newest first, capped at 100, each tagged with its
  `storeSlug`. Stats live at `src/app/api/creator/stats+api.ts` (revenue + order count for
  paid-and-beyond statuses, 30-day pageviews). Refund at
  `src/app/api/creator/orders/[id]/refund+api.ts` (`POST`) — ownership-checked, full refund,
  reverses the Connect transfer + platform fee when `applicationFeeCents > 0`, idempotent on an
  already-`refunded` order.
- **platform-api** — `platform-api/app/api/creator/orders/route.ts` (+ `/[id]/refund`, `/stats`):
  the **same** authed, `accessibleStoreIds`-scoped logic, called by the storefront `/admin`.

Every one of these requires a creator token (`getUserFromRequest`) and filters by store
membership via `src/lib/tenant.ts`. A creator only ever sees **their** stores' orders.

## There is NO shopper "my orders" today

Nothing lets a *buyer* look up their own orders. The only order-reading surfaces are
creator-scoped (above). Because a shopper isn't an account
([AUTH_IDENTITY.md](AUTH_IDENTITY.md)) and `orders` has no user FK, there is nowhere — app or
brand site — for a customer to see "my past orders." Post-purchase, the shopper has only Stripe's
receipt email and the order's tracking link.

## Target — shopper "my orders" by email match (task list #23–24, #26, #28)

Once a brand site can create a real Nano Crew account ([AUTH_IDENTITY.md](AUTH_IDENTITY.md)
"Target"), a logged-in shopper gets a "my orders" view that works **with no schema change**:

- **Match `orders.customerEmail` to the logged-in account's email.** The account's email comes
  from the same Supabase identity; the order's email came from Stripe at checkout. When they're
  equal, the order is "yours." (`creators.email` is UNIQUE, so the match is unambiguous.)
- A new **shopper-scoped, authed** read endpoint (distinct from the creator routes, which scope
  by store) returns the caller's orders where `customerEmail = <their account email>`.
- Surfaced in **two places**: on the brand site (a shopper account page) **and** in the Nano Crew
  app (the buyer's order history across every brand they've purchased from) — one account, one
  order history, everywhere.

Implementation notes for whoever builds it: the email match only covers orders placed with that
same email; orders checked out with a different email than the account won't appear (acceptable
for v1). Wire the brand-site half at the **template level** so every generated site ships it, and
update this doc + [AUTH_IDENTITY.md](AUTH_IDENTITY.md) in the same change.
</content>
