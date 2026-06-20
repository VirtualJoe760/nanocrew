# Returns, refunds & the payout hold

How a sale settles, how the 7-day return window works, and how a customer return becomes a refund.
This is the doc for **anything touching the money lifecycle after checkout** — the payout hold, the
`return_requests` model, the public returns API, the creator returns inbox, and the buyer "Purchases"
surface. Read it before editing checkout, the Stripe/Printful webhooks, `src/lib/connect.ts`, or any
returns surface. Pairs with [ORDERS.md](ORDERS.md) (the order identity), [BILLING_CREDITS.md](BILLING_CREDITS.md)
(plans/credits/Connect) and [EMAIL_PIPELINE.md](EMAIL_PIPELINE.md) (the emails each step fires).

> **Not legal advice.** Return/refund obligations and Merchant-of-Record status are a counsel call
> (see [COMPLIANCE.md](COMPLIANCE.md) → "Open for counsel"). This doc describes the *system*, not the
> legal position.

## The flow (end to end)

```
Buyer pays  ──►  Nano Crew (platform) captures 100%  ──►  platform pays Printful to make + ship
                                                              │
                                            Printful ships ───┤ package_shipped webhook
                                                              │   • status → shipped, tracking saved
                                                              │   • shippedAt = now
                                                              │   • returnWindowEndsAt = payoutReleaseAt = shippedAt + 7d
                                                              ▼
                          ┌──────────────  7-day return window  ──────────────┐
                          │  buyer may open a defect/wrong/damaged claim        │
                          └─────────────────────────────────────────────────────┘
                                     │ no claim                    │ claim approved
                                     ▼                              ▼
                       release job (≥ payoutReleaseAt):     refund from HELD funds
                       transfers.create → brand paid         (transfer never sent → 'skipped')
                       payoutStatus = 'released'             payoutStatus = 'skipped', order 'refunded'
```

The crux: **the brand is NOT paid at checkout.** We capture the full charge to the platform, pay
Printful at submission from money we hold, and only transfer the brand's profit **after the return
window closes** with no open claim. A refund inside the window is just "don't send the transfer" —
no risky claw-back.

## Decisions locked (owner, 2026-06-20)

| Decision | Choice | Consequence |
|---|---|---|
| **Email/ESP** | Resend | Reuse `platform-api/lib/notify.ts`; see [EMAIL_PIPELINE.md](EMAIL_PIPELINE.md) |
| **Return scope** | **Defect / wrong / damaged / not-received only** | No buyer's-remorse ship-backs (matches POD reality). 7 days = the *claim* window. Photo evidence required for defective/damaged |
| **Refund funding** | **Held funds; free reprint on defect** | In-window refunds come from money we still hold (brand's net reversed for that order). Genuine defects → free Printful reprint (Printful covers misprints) |
| **7-day clock** | **Ship date + 7 days** | Anchored on `shippedAt` (from Printful `package_shipped`). **No carrier-delivery integration needed for v1** |

`RETURN_WINDOW_DAYS` env (default `7`) is the single knob; never hard-code the window.

## Why the charge model must change · `platform-api/app/api/public/checkout/route.ts`

Today checkout uses a **Stripe destination charge** (`payment_intent_data.transfer_data.destination`
+ `application_fee_amount`) — the instant the charge clears, Stripe splits it and the brand's profit
lands in its connected balance **immediately**. That makes a 7-day hold impossible.

**Switch to separate charges and transfers** (Stripe's canonical held-marketplace pattern):

1. **Drop `transfer_data` / `application_fee_amount`.** Capture 100% of the charge to the platform.
2. **Keep the existing fee/COGS math** (`checkout/route.ts` lines ~86–95) — it already computes the
   brand's exact net. Persist it: `brandNetCents = totalCents − applicationFeeCents`,
   `connectedAccountId = <snapshot of the destination>`, `payoutStatus = 'held'`.
3. When the brand has **no charges-enabled Connect account**, settle to the platform as before:
   `payoutStatus = 'none'`, `brandNetCents = 0` (nothing to transfer). Unchanged behaviour.
4. The platform pays Printful at submission (unchanged) — out of the funds it now holds.

> **Live-commerce risk.** This alters how every future sale settles on `sk_live`. Cut over cleanly:
> orders record their own `payoutStatus`, so a half-migrated mix is unambiguous, but don't deploy the
> checkout change and the release job out of step. Coordinate with `STRIPE_CONNECT_ENABLED`.

## The payout state machine · new columns on `orders`

Migration `0024` (already applied to `src/db/schema.ts` + `platform-api/db/schema.ts`):

| Column | Meaning |
|---|---|
| `shippedAt` | stamped in the `package_shipped` webhook branch |
| `returnWindowEndsAt` | `shippedAt + RETURN_WINDOW_DAYS` — the claim deadline |
| `stripeChargeId` | the charge = `source_transaction` for the held transfer (captured at `checkout.session.completed` from the PaymentIntent's `latest_charge`) |
| `brandNetCents` | the deferred transfer amount |
| `connectedAccountId` | transfer destination, snapshotted at checkout |
| `payoutStatus` | `none · held · released · reversed · skipped` |
| `payoutReleaseAt` | = `returnWindowEndsAt`; when the release job may transfer |
| `payoutTransferId` | the Stripe transfer id once released |

```
none     →  (no connected account; settled to platform)                      terminal
held     →  release job, window clean         →  released
held     →  refund/return in-window           →  skipped   (transfer never sent)
released →  refund after release              →  reversed  (reverse_transfer fallback)
```

### The release job (the missing scheduler)

platform-api is **Vercel serverless** — no persistent worker. Two options; **prefer the Railway
backend** (already a persistent Node process) OR a Vercel Cron hitting an internal route:

- Scan `orders WHERE payoutStatus = 'held' AND payoutReleaseAt < now() AND status NOT IN
  ('return_requested','returned','refunded','cancelled','failed')`.
- For each: `stripe.transfers.create({ amount: brandNetCents, currency, destination: connectedAccountId,
  source_transaction: stripeChargeId, transfer_group: orderId })`, then set `payoutTransferId` +
  `payoutStatus = 'released'`.
- **Idempotent + durable:** guard on `payoutStatus`, use a Stripe idempotency key per order, and
  **alert on failure** — a silently-failing job means brands never get paid. Put the transfer helper
  in `src/lib/connect.ts` next to `refundPayment` as `releasePayout(order)`.

Auth the internal route with `INTERNAL_API_KEY` (constant-time compare, as the first-drop path does).

## The returns model · `return_requests` table

```ts
return_requests {
  id, orderId → orders, storeId → stores,        // storeId denormalized for the creator inbox + RLS
  customerEmail,
  reason: 'defective' | 'wrong_item' | 'damaged' | 'not_received',
  itemsJson,                                      // which line items (null = whole order)
  photoUrls,                                      // evidence — required for defective/damaged
  note,
  status: 'requested' | 'approved' | 'declined' | 'refunded',
  resolution, refundId, rmaCode,                  // rmaCode usually unused (no physical ship-back)
  createdAt, resolvedAt,
}
```
RLS is **enabled deny-all** (migration `0024`) per the [supabase-rls](../../) rule. `order_status`
gains `return_requested` (distinct from `returned`, which is the Printful package-came-back event).

### Endpoints — thin-client rule: returns logic lives in platform-api

Storefronts carry **no commerce backend**; they only *call* these. Mirror `checkout/route.ts`'s
`corsJson`/`corsPreflight` + zod conventions.

| Endpoint | Who | Does |
|---|---|---|
| `POST /api/public/order-lookup` `{ email, orderNumber }` | guest (brand site) | minimal order view → gates the guest return flow (reuses `customerEmail`) |
| `POST /api/public/returns` `{ orderId, reason, photoUrls, note, items? }` | guest + app | validates window (`now < returnWindowEndsAt`) + reason + photo; inserts `return_requests`; flips order → `return_requested`; **sends buyer ack + notifies the brand** |
| `GET /api/customer/orders` | **authed buyer** | the signed-in user's orders where `lower(customerEmail) = lower(user.email)` — the app "Purchases" surface. DIRECT API, not the forge |
| `GET/POST /api/creator/returns` + `/[id]/approve` `/[id]/decline` | **authed creator** | the Studio returns inbox; **approve calls the EXISTING refund path** (do not duplicate money movement); decline → `declined` + email |

**Ownership scope:** use `accessibleStoreIds()` consistently (fixes the current divergence where the
refund route joins `stores.creatorId` (owner-only) but order *listing* uses `accessibleStoreIds()`
(owner + collaborators)).

## Refund mechanics — reuse, don't rebuild · `src/lib/connect.ts` `refundPayment`

The existing creator refund (`/api/creator/orders/[id]/refund`) already does a full Stripe refund and,
for the old destination-charge model, `reverse_transfer` + `refund_application_fee`. Under the hold:

- **In-window (`payoutStatus = 'held'`)** → refund the buyer; **cancel the un-sent transfer**
  (`payoutStatus = 'skipped'`). Nothing to reverse — the brand was never paid. This is the common case
  and it **dissolves** the old negative-balance claw-back risk.
- **After release (`payoutStatus = 'released'`)** → fall back to the existing `reverse_transfer` path
  (`payoutStatus = 'reversed'`). Still possible for a late claim; the hold shrinks but doesn't
  eliminate this window.
- **Defect** → optionally trigger a free Printful reprint instead of/alongside the refund (Printful
  covers genuine misprints at no cost to us).

The approve action branches on `payoutStatus`; the refund route gains that branch. Partial refunds and
Printful cancel-if-unproduced are noted as follow-ups (today's refund is full-only).

## App surface · `src/app/account.tsx`

- New **"Purchases"** section (a `SectionLabel` + `Card` between "Your brands" and "Commerce"),
  the `src/components/purchases.tsx` modal cloned from `src/components/earnings-cockpit.tsx` (Modal +
  status-badge rows, monochrome app chrome). Lists the buyer's orders (`GET /api/customer/orders`),
  each with status, tracking, and items, and — when `order.canRequestReturn` is true — a
  **"Request a return"** action that opens a reason-picker + photo/note form. The form POSTs the
  thin app proxy `POST /api/customer/returns` (`src/app/api/customer/returns+api.ts`), which resolves
  the signed-in buyer (`getUserFromRequest`) and forwards to platform-api `POST /api/public/returns`
  with the verified account email — keeping all returns logic + emails central (thin-client rule),
  the same way checkout proxies through `store/[slug]/checkout`.
- **Fix buyer attribution:** in-app checkout currently writes `pending@checkout`. The in-app checkout
  proxy `src/app/api/store/[slug]/checkout+api.ts` now resolves the signed-in user's email (token
  verified locally, no DB query) and forwards `customerEmail` to platform-api's checkout so in-app
  purchases attribute to the account up front (guests/brand-site buyers still match by Stripe email;
  a guest `order-lookup` covers the rest). The caller `src/components/product-detail.tsx` switched its
  Buy call from `fetch` to `apiFetch` so the token is attached.
- **Creator returns inbox** in the Studio Console (new component, mounted in `studio-composer.tsx`):
  list `requested` claims, view photos, Approve/Decline.

## Templates & sites — wire it once, every brand ships it

Thin-client: a returns **policy page** + a **"request a return"** flow added at the template level
(see [TEMPLATE_AUTHORING.md](../storefront/TEMPLATE_AUTHORING.md) + [COMPONENT_SYSTEM.md](../storefront/COMPONENT_SYSTEM.md)):

- Add `'returns'` to the `POLICIES` array + `content/policies/returns.md`; add a **Returns** +
  **Request a return** link to `components/blocks/footer.tsx`.
- Add `submitReturnRequest()` + `lookupOrder()` to `templates/_shared/lib/api.ts` (mirror
  `createCheckout()`); run `scripts/sync-shared.mjs` to the 4 standard templates.
- Wire `street` separately (its own returns prose) and **de-brand the leaked
  `hello@stephenlawyer.clothing`** it hardcodes.
- Same for `nanocrew-site` (the HQ store).
- Author returns into the **forge brief** so newly-generated brands ship it. If returns content is
  vendored into `_shared`/`components.json`, the **forge-worker droplet needs a re-scp** — a
  coordinated release (template push + worker redeploy), like the image-edit batch.

> **Fleet drift:** template changes only reach brands provisioned *after* the change. Existing brand
> sites need a re-provision/backfill to get the returns page.

## Compliance & MoR (open for counsel)

Under separate charges, the **platform may be Merchant of Record** and thus legally own the
refund/return obligation to the buyer. Building the obligation onto the creator while the platform is
MoR is a mismatch. Scope the policy copy to **defect/wrong/damaged claims** before launch and confirm
MoR + the Terms wording with counsel. Add the POD no-buyer's-remorse constraint to
[POD_POLICY.md](POD_POLICY.md) and the MoR/return-window position to [COMPLIANCE.md](COMPLIANCE.md).

## Owner config (outside the repo — gates go-live, not code)

- `STRIPE_CONNECT_ENABLED=1` + per-creator `charges_enabled` (the hold only matters once Connect is live).
- The release job scheduler (Railway cron or Vercel Cron) + `INTERNAL_API_KEY` + failure alerting.
- `RETURN_WINDOW_DAYS` (default 7), `RETURNS_PHOTO_*` upload config.
- Counsel sign-off on MoR + return policy wording.
