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
the paid order to Printful (`submitOrderToPrintful`) and sends the order-confirmation email. Other
events: `checkout.session.expired` → `cancelled`; `charge.refunded` (full) → `refunded` +
refund-confirmation email. Further fulfilment transitions (`shipped`, `delivered`, `on_hold`,
`returned`, `failed`) come from the Printful webhook — and `package_shipped` now also stamps
`shippedAt` + `returnWindowEndsAt` = `payoutReleaseAt` (ship + `RETURN_WINDOW_DAYS`, default 7),
opening the return window and the payout hold (see [BILLING_CREDITS.md](BILLING_CREDITS.md) →
"Payout timing" and [RETURNS_REFUNDS.md](RETURNS_REFUNDS.md)).

**`return_requested` — the customer return claim.** A buyer can open a defect/wrong/damaged/
not-received claim inside the window (`POST /api/public/returns`), which inserts a `return_requests`
row and flips the order to **`return_requested`** (a status distinct from `returned`, the Printful
package-came-back event). The brand resolves it from the Studio returns inbox: **approve** → the
shared refund path (`refundOrder`, branching on `payoutStatus`) → order `refunded`; **decline** →
order reverts to `shipped`, no money moves. The full model, the held-payout interplay, and the email
each step fires are in [RETURNS_REFUNDS.md](RETURNS_REFUNDS.md) +
[EMAIL_PIPELINE.md](../accounts/EMAIL_PIPELINE.md).

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

## The shopper "Purchases" surface — being built (email match)

Historically nothing let a *buyer* look up their own orders: the only order-reading surfaces were
creator-scoped (above), a shopper isn't an account ([AUTH_IDENTITY.md](AUTH_IDENTITY.md)), and
`orders` has no user FK — so post-purchase the shopper had only Stripe's receipt email and the
tracking link. That gap is now being closed (the returns feature needs it). The buyer view works
**with no schema change**, by **email match**:

- **Match `orders.customerEmail` to the logged-in account's email.** The account's email comes from
  the same Supabase identity; the order's email came from Stripe at checkout. When they're equal,
  the order is "yours." (`creators.email` is UNIQUE, so the match is unambiguous.)
- **`GET /api/customer/orders`** (`src/app/api/customer/orders+api.ts`) — a **shopper-scoped, authed**
  read (distinct from the creator routes, which scope by store) returning the caller's orders where
  `lower(customerEmail) = lower(user.email)`, newest first, each with its line items, status,
  tracking, return window, and a `canRequestReturn` flag. This is a **DIRECT API** (a plain DB read),
  not the forge. It backs the app's **"Purchases"** section (`src/components/purchases.tsx`).
- For guests on a brand site (no account), `POST /api/public/order-lookup { email, orderNumber }`
  gates the guest return flow by matching the email to the order id.

Surfaced in the Nano Crew app today (the buyer's order history across every brand they've purchased
from); the brand-site shopper account page is the remaining template-level half.

Implementation note: the email match only covers orders placed with that same email; orders checked
out under a different email than the account won't appear (acceptable for v1). The in-app checkout
proxy now resolves the signed-in user's email up front so in-app purchases attribute to the account
(guests/brand-site buyers still match by Stripe email). Wire the brand-site half at the **template
level** so every generated site ships it, and update this doc + [AUTH_IDENTITY.md](AUTH_IDENTITY.md)
in the same change. The return flow on top of this surface is in
[RETURNS_REFUNDS.md](RETURNS_REFUNDS.md).
</content>
