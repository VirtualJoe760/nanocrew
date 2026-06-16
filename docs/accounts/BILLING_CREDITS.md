# Billing, Credits & Payouts

Everything that touches a creator's money: the **subscription** that gates launching a store, the
**AI credits** that meter generation spend, and the **Stripe Connect** account that pays the
creator out. All three hang off `creators.id` ([AUTH_IDENTITY.md](AUTH_IDENTITY.md)). All three
talk to Stripe over **plain REST** from the Expo app (no Stripe SDK in the app); the
signature-verifying webhooks live in platform-api.

> Scope: this is the creator's *own* money. The shopper-side payment (storefront checkout → the
> brand's order) is in [ORDERS.md](ORDERS.md) and
> [STOREFRONT_DATA_CONTRACT.md](../storefront/STOREFRONT_DATA_CONTRACT.md).

---

## 1. Plans / subscriptions · `src/lib/billing.ts`, `subscriptions` table

A subscription **gates launching a store**. Free = browse + shop only; the three paid tiers each
carry a monthly credit allotment and a brand cap.

`subscriptions` (`src/db/schema.ts`) — one row per creator:

```ts
plan: subscriptionPlan('plan')      // 'free' | 'starter' | 'pro' | 'advanced'
status: subscriptionStatus('status') // 'active' | 'trialing' | 'past_due' | 'canceled'
stripeCustomerId, stripeSubscriptionId (unique), currentPeriodEnd
```

The tier definitions live in `TIERS` (`src/lib/billing.ts`) — **the source of truth for
prices/credits/caps** (the schema enum comment lists older numbers; trust the code):

| Plan | Price/mo | Monthly credits | Max brands | Website + domain | Top-up rate |
|---|---|---|---|---|---|
| `starter` | $10 (1000¢) | 500 | 1 | ❌ | list |
| `pro` | $50 (5000¢) | 3000 | 3 | ✅ | list |
| `advanced` | $149 (14900¢) | 12000 | 99 | ✅ | 0.8 (20% off) |

`website: true` (Pro+) is what entitles a creator to a real storefront website + custom domain.

**Reads** — `GET /api/creator/subscription` (`src/app/api/creator/subscription+api.ts`) returns
`getEntitlements(user.id)` (plan, `active`, `maxBrands`, `monthlyCredits`, `website`,
`creditRateMultiplier`, `currentPeriodEnd`), the current `brandCount` vs cap, a `canLaunch`
boolean, and the `TIERS` + `CREDIT_PACKS` catalogue so the paywall renders without hardcoding
prices. Entitlements collapse to `FREE_ENTITLEMENTS` unless a **paid** plan is `active`/`trialing`.
`canLaunchStore()` is the gate enforced at store creation.

**Subscribe** — `POST /api/creator/billing/checkout { kind: 'subscription', plan }`
(`src/app/api/creator/billing/checkout+api.ts`) → `createSubscriptionCheckout()` builds a Stripe
Checkout Session (recurring price from `STRIPE_PRICE_<TIER>`, customer keyed to `creatorId`) and
returns its URL.

**Manage** — `GET /api/creator/billing/portal` → `createBillingPortalSession()` returns a Stripe
Customer Portal URL (cancel/update card/plan); null if the creator has no Stripe customer yet.

**Activation is the webhook's job** — `platform-api/app/api/public/billing-webhook/route.ts`
(its own secret, separate from the order webhook). On `checkout.session.completed` it
`upsertSubscription(...)` (plan, status, customer/subscription ids, period end); on `invoice.paid`
it grants that month's credits **idempotently** (ledger-checked); `customer.subscription.updated`
/`.deleted` mirror status changes.

---

## 2. AI credits · `src/lib/credits.ts`, `credit_accounts` + `credit_ledger`

Every AI operation debits credits (cost **already includes our markup**, so debits = revenue and
the ledger doubles as the cost/profit audit). **1 credit ≈ $0.01 retail.**

- `credit_accounts` — `creatorId` PK + cached `balance`.
- `credit_ledger` — append-only audit: `delta` (+grant/−debit), `reason`, optional `refId`,
  `balanceAfter`. The balance is the running sum, cached on the account.

**First touch grants a signup bonus.** `ensureCreditAccount()` (called by `getBalance`, and on
the first `GET /api/creator/credits`) creates the account with **200 credits** (`signup_bonus`)
on first use.

**Fixed per-operation costs** — `CREDIT_COSTS` (`src/lib/credits.ts`):

| Op | Credits |
|---|---|
| `design_generate` | 5 |
| `tryon` | 6 |
| `logo_generate` | 8 |
| `model_shots` | 20 |
| `video_voiceover` | 25 |
| `revision` | 60 |
| `video_veo` | 400 |

**Variable-cost ops** debit via `debitCredits()` with their own reason: scene-video ("cool
short", `scene_video`) charges the tier price from `VIDEO_MODELS` (`src/lib/fal-video.ts`); buying
a custom domain charges `domain` (`src/lib/domains.ts`). Debits throw `InsufficientCreditsError`
when the balance is too low.

**Reads / top-ups** — `GET /api/creator/credits` (`src/app/api/creator/credits+api.ts`) returns
the balance, the `CREDIT_COSTS` price list, the scene-video model tiers, and a 20-row ledger.
Top-ups: `POST /api/creator/billing/checkout { kind: 'credit_pack', packId }` →
`createCreditPackCheckout()` (web Stripe); the buyer's plan `creditRateMultiplier` discounts the
pack (Advanced 20% off). In-app top-ups go through Apple IAP
(`src/app/api/creator/billing/iap-verify+api.ts`; the client adds Apple's cut markup) — gated off
until `IAP_ENABLED` (see `CLAUDE.md`). `CREDIT_PACKS`: 500¢→500, 1200¢→1500, 3500¢→5000 credits.

**Grants land via the webhook** — `topup` (credit packs) and `subscription_grant` (monthly
invoices) are credited in `billing-webhook`, **idempotent on the Stripe id** via
`ledgerHas(reason, refId)`.

---

## 3. Creator payouts · `src/lib/connect.ts`, `connected_accounts` table

Stripe **Connect** is how each creator gets *paid*. Each creator has **one Express connected
account**; their brands' storefront checkouts route money to it as a **destination charge with an
application fee** (the platform's cut). Talks to Stripe over REST; the `account.updated` webhook
in `stripe-webhook` syncs the capability flags.

`connected_accounts` (`src/db/schema.ts`) — `creatorId` (unique) → `stripeAccountId` (unique) +
`chargesEnabled` / `payoutsEnabled` / `detailsSubmitted`.

**Routes** — `src/app/api/creator/connect+api.ts`:
- `GET` → the creator's payout status, refreshed live from Stripe via
  `refreshConnectedAccount()` when an account exists; reports `needsOnboarding`.
- `POST` → `ensureConnectedAccount(user.id, user.email)` (creates the Express account on first
  call) + `createOnboardingLink()` → a Stripe-hosted onboarding URL.

**Helpers** (`src/lib/connect.ts`): `ensureConnectedAccount`, `createOnboardingLink`
(account_links), `refreshConnectedAccount` (GET account → persist flags), `getConnectedAccount`,
`refundPayment` (reverses the brand's transfer + claws back the platform fee on a destination
charge), and `goLiveBlockReason` (the go-live gate).

**Inert until Joe enables it.** Account creation only works once Connect is enabled on the
platform Stripe account (otherwise Stripe rejects `/v1/accounts` and `POST /api/creator/connect`
surfaces a friendly "Payouts aren't available yet"). The go-live gate is enforced **only** when
`connectEnabled()` is true (`STRIPE_CONNECT_ENABLED` + `STRIPE_SECRET_KEY`); until then a store
can go live and checkout settles to the **platform** account exactly as before
(`platform-api/.../checkout/route.ts` only adds the `transfer_data.destination` +
`application_fee_amount` when the creator has a `charges_enabled` account). See the
LIFECYCLE_ROADMAP Phase D notes for the full money split.
</content>
