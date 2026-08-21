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

## The charge model — separate charges and transfers · `platform-api/app/api/public/checkout/route.ts`

Checkout used to create a **Stripe destination charge** (`payment_intent_data.transfer_data.destination`
+ `application_fee_amount`) — the instant the charge cleared, Stripe split it and the brand's profit
landed in its connected balance **immediately**, which made a 7-day hold impossible. The switch to
**separate charges and transfers** (Stripe's canonical held-marketplace pattern) has shipped:

1. **No `transfer_data` / `application_fee_amount`** — checkout sends no `payment_intent_data` at
   all; 100% of the charge is captured to the platform.
2. **The fee/COGS math is unchanged** — it computes the brand's exact net and persists it:
   `brandNetCents = totalCents − applicationFeeCents`,
   `connectedAccountId = <snapshot of the destination>`, `payoutStatus = 'held'`.
3. **KYC hard gate (Joe, 2026-08-16).** When the brand's creator has **no charges-enabled Connect
   account**, checkout **refuses with a 409** ("This shop can't take orders yet — the owner is still
   setting up payments") rather than settling to the platform — the old fallback completed the sale
   with the creator silently earning nothing transferable, worse than failing. The only opt-out is
   `PLATFORM_SETTLED_SLUGS` (comma-separated env) for platform-owned demo stores, which settle to
   the platform (`payoutStatus = 'none'`, `brandNetCents = 0`).
4. The platform pays Printful at submission (unchanged) — out of the funds it now holds.

> **Live-commerce note.** Every order records its own `payoutStatus`, so pre-cutover
> destination-charge orders and held orders coexist unambiguously.

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

### The release job — LIVE on Cloud Scheduler (2026-08-16)

The job runs on the **Cloud Run backend** (a persistent Node process — platform-api is Vercel
serverless): Cloud Scheduler job `release-payouts` (project `nanocrew-api`, us-west1) POSTs
`/api/internal/release-payouts` at `0 17 1,15 * *` UTC — the 1st and 15th, the biweekly
disbursement. What a run does (`src/app/api/internal/release-payouts+api.ts`):

- Scans `orders WHERE payoutStatus = 'held' AND payoutReleaseAt < now() AND status NOT IN
  ('return_requested','returned','refunded','cancelled','failed')`.
- For each: `releasePayout(order)` (`src/lib/connect.ts`) — `stripe.transfers.create({ amount:
  brandNetCents, currency, destination: connectedAccountId, source_transaction: stripeChargeId,
  transfer_group: orderId })`, then `payoutTransferId` + `payoutStatus = 'released'`, plus a
  best-effort creator payout email via `/internal/notify`.
- **Idempotent + durable:** each order is re-guarded on `payoutStatus = 'held'` at transfer time and
  `releasePayout()` uses a per-order Stripe idempotency key, so a retried or overlapping run can
  never double-pay.
- **Stuck-funds sweep:** orders `held` for >14 days with a NULL `payoutReleaseAt` (the ship webhook
  never arrived, so the scan can never match them — `lt()` is never true for NULL) are surfaced as
  `stuckHeld`/`stuckHeldIds`. The run returns `{ scanned, released, failed, errors, stuckHeld,
  stuckHeldIds }`; **alerting should page on a non-zero `failed` or `stuckHeld`** (Cloud Scheduler
  logs each run's response) — a silently-failing job means brands never get paid.

The route is authed with `INTERNAL_API_KEY` (constant-time compare, as the first-drop path does).

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
| `POST /api/public/returns` `{ orderId, customerEmail, reason, photoUrls, note, items? }` | guest + app | **`customerEmail` is required ownership proof** — missing or mismatched → an opaque 404 (no enumeration/IDOR; the app proxy attaches the verified account email, the guest flow the lookup email); validates window (`now < returnWindowEndsAt`) + reason + photo; inserts `return_requests`; flips order → `return_requested`; **sends the buyer ack** (a brand/creator notification is a follow-up — today a brand only discovers claims by opening the returns inbox) |
| `GET /api/customer/orders` | **authed buyer** | the signed-in user's orders where `lower(customerEmail) = lower(user.email)` — the app "Purchases" surface. DIRECT API, not the forge |
| `GET /api/creator/returns` + `POST /[id]/approve` · `POST /[id]/decline` | **authed creator** | the Studio returns inbox; **approve calls the EXISTING refund path** (do not duplicate money movement); decline → `declined` + email |

**Ownership scope:** `accessibleStoreIds()` everywhere — owner + collaborators. Done 2026-08-20
(Joe's call, BUG_AUDIT #29): the refund route used to join `stores.creatorId` (owner-only) while
order listing and return approve/decline were already collaborator-scoped — and since approving a
return calls this very refund path, owner-only was an incoherent split rather than a safeguard.

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
  a guest `order-lookup` covers the rest). **The receiving end is currently broken in code:**
  platform-api's checkout drops the forwarded `customerEmail` and still inserts `pending@checkout`
  (see `docs/ops/BUG_AUDIT_2026-08-20.md`). The caller `src/components/product-detail.tsx` switched its
  Buy call from `fetch` to `apiFetch` so the token is attached.
- **Creator returns inbox** in the Studio Console (new component, mounted in `studio-composer.tsx`):
  list `requested` claims, view photos, Approve/Decline.

## Templates & sites — wire it once, every brand ships it

Thin-client: a returns **policy page** + a **"request a return"** flow added at the template level
(see [TEMPLATE_AUTHORING.md](../storefront/TEMPLATE_AUTHORING.md) + [COMPONENT_SYSTEM.md](../storefront/COMPONENT_SYSTEM.md)):

- ✅ `'returns'` is in the `POLICIES` array + `content/policies/returns.md`; the footer carries
  **Returns** + **Request a return** links (`components/blocks/footer.tsx`), and
  `app/returns/request/page.tsx` hosts the claim form.
- ✅ `submitReturnRequest()` + `lookupOrder()` live in `templates/_shared/lib/api.ts` (mirroring
  `createCheckout()`), synced to the templates.
- ✅ `street` is wired with its own returns prose, and the leaked `hello@stephenlawyer.clothing`
  it hardcoded is de-branded.
- ✅ `nanocrew-site` (the HQ store) ships the flow too (`app/store/returns/` + its `api/returns` /
  `api/order-lookup` proxies).
- ⬜ Author returns into the **forge brief** so newly-generated brands ship it (not there yet). If
  returns content is vendored into `_shared`/`components.json`, the **forge-worker droplet needs a
  re-scp** — a coordinated release (template push + worker redeploy), like the image-edit batch.

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
- ✅ The release job scheduler — Cloud Scheduler `release-payouts`, biweekly (see "The release job"
  above) + `INTERNAL_API_KEY`. Failure alerting on `failed`/`stuckHeld` still needs a pager target.
- `RETURN_WINDOW_DAYS` (default 7), `RETURNS_PHOTO_*` upload config.
- Counsel sign-off on MoR + return policy wording.
