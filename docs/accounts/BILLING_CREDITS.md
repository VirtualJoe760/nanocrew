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

| Plan | Price/mo | Monthly credits | Eff. $/credit | Max brands | Website + domain | Top-up rate |
|---|---|---|---|---|---|---|
| `starter` | $10 (1000¢) | 500 | $0.020 | 1 | ❌ | list ($0.01) |
| `pro` | $50 (5000¢) | 3000 | $0.0167 | 3 | ✅ | list ($0.01) |
| `advanced` | $149 (14900¢) | 12000 | $0.0124 | 99 | ✅ | list ($0.01) |

**The credit economy (the rule that keeps every generation profitable):** a credit is a flat
**$0.01 everywhere** — credit packs carry **no volume discount** (removed the old Advanced 20%-off),
so $0.01/cr is the hard **profitability floor**. Every generation charge is sized at **≥2× our real
API cost measured at that floor**. Plan allotments give a *better effective rate* (Starter $0.020/cr
→ Advanced $0.0124/cr), so the **cheaper the plan, the better our margin** — and every tier still
clears the floor. Real costs anchoring the charges: Nano Banana (gemini-2.5-flash-image) ≈
**$0.039/image**, Veo 3 Fast ≈ **$0.15/s**, fal Seedance 2.0 (5s) ≈ **$1.21**, fal Wan 2.5 (5s) ≈
**$0.25**, ElevenLabs voiceover ≈ **$0.01**.

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

| Op | Credits | Charged at |
|---|---|---|
| `design_generate` | 8 | `POST /api/generate` (default) — every image generation: Design tab + the voice critique loop's hero/og. Sized at ~2× one Nano Banana image (~$0.039) at the $0.01/cr floor. |
| `tryon` | 6 | NOT debited — rate-limited instead (shopper-facing conversion feature) |
| `logo_generate` | 8 | `POST /api/generate` when `purpose:'logo'` (the critique loop sends it for the logo slot) |
| `model_shots` | 25 | `POST /api/creator/model-shots` |
| `video_voiceover` | 25 |
| `revision` | 60 |
| `video_veo` | 400 |

`/api/generate` skips the debit for the **internal first-drop system identity** (`x-internal-key` → `internal@nanocrew`), since the auto first drop is a free onboarding gift; comp creators are also no-oped by `debit()`. On a no-image failure the charge is **refunded** via `grant(..., 'refund')`.

**Variable-cost ops** debit via `debitCredits()` with their own reason: scene-video ("cool
short", `scene_video`) charges the tier price from `VIDEO_MODELS` (`src/lib/fal-video.ts` — Wan
**60** / Seedance 2.0 **260** / Veo3 **400**, each ≥~2× real cost at the floor); buying a custom
domain charges `domain` (`src/lib/domains.ts` — Vercel's yearly registration price passed through
at par **plus a flat $2.99 service fee**, `domainCredits()` = `price×100 + 299` credits; e.g. a
$6.99 domain → 998cr / $9.98). Debits throw `InsufficientCreditsError` when the balance is too low.

**Reads / top-ups** — `GET /api/creator/credits` (`src/app/api/creator/credits+api.ts`) returns
the balance, the `CREDIT_COSTS` price list, the scene-video model tiers, and a 20-row ledger.
Top-ups: `POST /api/creator/billing/checkout { kind: 'credit_pack', packId }` →
`createCreditPackCheckout()` (web Stripe). **No volume discount** — every plan's
`creditRateMultiplier` is **1**, so packs are a flat $0.01/cr. `CREDIT_PACKS`: 500¢→500,
1500¢→1500, 5000¢→5000 credits.

**In-app purchases (Apple IAP) — StoreKit 2.** Both plans (auto-renewable subscriptions,
`com.nanocrew.plan.*`) and credit packs (consumables, `com.nanocrew.credits.*`) can be bought via
IAP on iOS, at App-Store prices set ~43% above web to absorb Apple's cut; web Stripe stays cheaper.
The server verifies via the **App Store Server API** (`src/lib/app-store.ts` signs an ES256 JWT and
pulls the signed transaction straight from Apple — no legacy verifyReceipt, no extra deps). The
client sends a `transactionId` (with `appAccountToken` = creator id for binding);
`iap-verify` grants credits or activates the subscription + first month, idempotent on the
transactionId. Subscriptions re-verify on launch (new period → new transactionId → grant);
`getEntitlements` lapses an Apple sub once `currentPeriodEnd` passes. `react-native-iap` (v15) is
**installed** and the client (`src/lib/iap.ios.ts`) + paywall prefer IAP on iOS with a web-Stripe
fallback; plan products (`com.nanocrew.plan.{starter,pro,advanced}`) are defined in
`src/lib/iap-products.ts`. **Inert until `APPLE_IAP_KEY_ID / ISSUER_ID / PRIVATE_KEY` +
`APPLE_BUNDLE_ID` are set on Cloud Run and the App Store Connect products exist** (see `CLAUDE.md`).

**Grants land via the webhook** — `topup` (credit packs) and `subscription_grant` (monthly
invoices) are credited in `billing-webhook`, **idempotent on the Stripe id** via
`ledgerHas(reason, refId)`.

### Comp / internal accounts · `src/lib/comp.ts`

Founders, team, and demo accounts aren't billed. `COMP_EMAILS` (comma-separated; **falls back to
`PLATFORM_ADMIN_EMAILS`**) lists the comp emails. For a comp creator, `getEntitlements` returns
**top-tier free entitlements** and `debitCredits` **no-ops** (never charged). So internal use never
spends real money or hits the paywall.

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
charge), and `goLiveBlockReason` (the go-live gate). Two more — `releasePayout(order)` (sends the
held transfer) and `refundOrder(orderId)` (the single refund path, branching on `payoutStatus`) —
serve the payout hold below.

### Payout timing — funds are now HELD (ship date + 7 days)

**Brands are no longer paid at checkout.** The storefront checkout moved from a Stripe **destination
charge** (instant split — profit lands in the brand's connected balance the moment the charge clears)
to **separate charges and transfers**: the platform captures 100% of the charge, pays Printful out of
the funds it holds, and only **transfers the brand's net after the return window closes** (`shippedAt
+ RETURN_WINDOW_DAYS`, default 7) with no open claim. Each order carries its own payout state on the
new `orders.payoutStatus` (`none · held · released · reversed · skipped`) +
`brandNetCents` / `connectedAccountId` / `payoutReleaseAt` / `payoutTransferId` columns, so a
half-migrated mix is unambiguous. The release job (`POST /api/internal/release-payouts`, Cloud Run cron,
`INTERNAL_API_KEY`-gated) scans `payoutStatus='held' AND payoutReleaseAt < now()` and calls
`releasePayout(order)`. A refund inside the window is just "don't send the transfer" (`skipped`) — no
risky claw-back; a refund after release falls back to `reverse_transfer` (`reversed`).

This is why the **destination-charge note above** (`checkout/route.ts` only adds
`transfer_data.destination` + `application_fee_amount`) describes the *old* path: under the hold the
checkout drops `transfer_data`/`application_fee_amount` and persists the brand's net as HELD instead.
Full mechanics — the charge-model switch, the state machine, the release job, and refund branching —
live in **[RETURNS_REFUNDS.md](RETURNS_REFUNDS.md)**.

**Inert until Joe enables it.** Account creation only works once Connect is enabled on the
platform Stripe account (otherwise Stripe rejects `/v1/accounts` and `POST /api/creator/connect`
surfaces a friendly "Payouts aren't available yet"). The go-live gate is enforced **only** when
`connectEnabled()` is true (`STRIPE_CONNECT_ENABLED` + `STRIPE_SECRET_KEY`); until then a store
can go live and checkout settles to the **platform** account exactly as before
(`platform-api/.../checkout/route.ts` only adds the `transfer_data.destination` +
`application_fee_amount` when the creator has a `charges_enabled` account). See the
LIFECYCLE_ROADMAP Phase D notes for the full money split.
</content>
