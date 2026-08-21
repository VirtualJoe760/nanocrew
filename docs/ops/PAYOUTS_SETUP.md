# Creator payouts — setup runbook (Stripe Connect)

How to turn on the **already-built** creator-payout system so sales money flows to the creators who
make them. **The code is complete and dormant** — this is pure configuration. ~10–15 minutes, all in
your Stripe Dashboard + one Cloud Run env var.

## What it does (so you know what you're enabling)

Each brand's storefront checks out through our central POS (`platform-api`). When a creator has a
**charges-enabled** Stripe Connect account, that brand's checkout becomes a **destination charge**
([`platform-api/app/api/public/checkout/route.ts`](../../platform-api/app/api/public/checkout/route.ts)):

- The customer pays through our Stripe checkout.
- Stripe routes the sale **to the creator's connected account**.
- We keep our **application fee** (the platform cut) automatically.
- Product cost + Printful fulfilment are paid out of the proceeds.

The creator-facing onboarding (Stripe-hosted identity + bank verification) lives in
[`src/lib/connect.ts`](../../src/lib/connect.ts) and the **"Set up payouts"** row on the Account
screen (`/api/creator/connect`). Accounts are **Stripe Connect Express**.

> Until this is enabled, sales still work — the money just settles to the **platform** account
> instead of splitting to the creator. Enabling it flips on the split; nothing else changes.

## Prerequisites

- ✅ `STRIPE_SECRET_KEY` is **live** (already done — commerce went live earlier).
- ✅ `connectedAccounts` table exists (shared Supabase DB, used by both app + platform-api).
- A Stripe account that's allowed to use Connect (any standard account can enable it).

## Step 1 — Enable Connect in Stripe (Express)

1. Stripe Dashboard → **Connect** (left nav) → **Get started**.
2. Platform type: choose the **platform / marketplace** option (you onboard sellers who get paid).
3. Account type: enable **Express** (Stripe hosts the seller onboarding + dashboard — least work for
   us, matches `type: 'express'` in `connect.ts`).
4. Fill the **platform profile** Stripe asks for (your business details, support email, what you
   sell — "creator-designed apparel, print-on-demand"). This is required before live Connect charges.

## Step 2 — Connect branding + payout settings (Stripe → Settings → Connect)

- **Branding:** business name "Nano Crew", logo, brand color — shown on the seller onboarding pages.
- **Statement descriptor** for connected accounts (what buyers see on their card statement).
- **Payout schedule:** default (Stripe's automatic daily/weekly) is fine; creators can adjust in
  their Express dashboard.
- Confirm **`account_onboarding`** links are allowed (they are by default; `connect.ts` uses them).

## Step 3 — Flip the switch on Cloud Run

Set on the **app backend** (Cloud Run — `backend-production-d7eb.up.railway.app`):

```
STRIPE_CONNECT_ENABLED=1
```

This is the documented gate (`connect.ts` `connectEnabled()`); it surfaces the "Set up payouts"
onboarding in the app. Redeploy/restart so the env takes effect.

- **platform-api (Vercel) needs no new env** — the checkout split auto-applies the moment a creator's
  account is charges-enabled (it just reads `connectedAccounts` from the shared DB). It only needs the
  live `STRIPE_SECRET_KEY` it already has.

## Step 4 — (Optional) live status webhook

Account status (`chargesEnabled` / `payoutsEnabled` / `detailsSubmitted`) already **refreshes
on-demand**: every time a creator opens the payouts screen, `GET /api/creator/connect` re-fetches the
account from Stripe and updates the row (`refreshConnectedAccount`). So you can launch without a
webhook.

For instant updates without the creator reopening the screen, add a Connect **`account.updated`**
webhook later that calls the same refresh — nice-to-have, not required for launch.

## Step 5 — Verify end to end

1. In the app (a non-comp creator account), Account → **Set up payouts** → it should open a Stripe
   **Express onboarding** URL (not the old "not available yet" error).
2. Complete Stripe's test/live onboarding (bank + identity).
3. Reopen payouts → status should read **charges enabled / payouts enabled**.
4. Buy one of that creator's products through their storefront → in Stripe → **Connect → that
   account**, confirm the charge landed there with your **application fee** retained.

## Money flow reference

- **Digital goods** (plans + credits) → **Apple IAP** / Stripe billing — *not* Connect; that's your
  revenue, not a creator payout.
- **Physical goods** (apparel) → **destination charge** to the creator's Connect account, minus
  product cost, fulfilment, and the platform application fee. See
  [`BILLING_CREDITS.md`](../accounts/BILLING_CREDITS.md) and
  [`commerce-pricing-flow`](../storefront/STOREFRONT_DATA_CONTRACT.md) for the fee math.

## Rollback

Unset `STRIPE_CONNECT_ENABLED` (or set to empty) and redeploy — onboarding hides and new checkouts
stop splitting (settling to the platform). Already-connected accounts are untouched.

## LIVE — 2026-08-16 (supersedes the checklist above where they differ)

Connect is enabled on the platform account (`acct_1ThhvX5lsCYjUGb3`) and `STRIPE_CONNECT_ENABLED=1`
is set. Three things changed going live; the "Money flow reference" above still says destination
charges — the code is actually **separate charges + transfers** (100% captured to the platform,
brand net HELD, transferred later).

- **Selling is now gated on KYC** (Joe: creators complete Stripe's verification *before* they can
  sell). Two enforcement points, both required:
  - `POST /api/creator/stores/:slug/publish` refuses (`409 payouts_required`) until
    `charges_enabled` — opening the shop is the real "start selling", not the domain flow.
  - `POST /api/public/checkout` (platform-api) refuses on its own — it is public and reachable by
    slug, so it cannot trust publish. The old silent fallback (settle 100% to the platform,
    `brandNetCents 0`) is gone; escape hatch for platform-owned demo stores:
    `PLATFORM_SETTLED_SLUGS` (comma-separated slugs).
- **The release job is actually scheduled now.** Cloud Scheduler job `release-payouts`
  (project `nanocrew-api`, `us-west1`): `0 17 1,15 * *` UTC — the 1st and 15th, the biweekly
  disbursement cadence — POSTing the Cloud Run route with `x-internal-key`. Verified live with a
  forced run (HTTP 200). Money therefore moves: held → (ship + `RETURN_WINDOW_DAYS`, default 7) →
  next 1st/15th → Stripe transfer → creator's bank on Stripe's automatic payout.
- **`releasePayout()` re-guards at transfer time** — re-reads `payoutStatus` immediately before the
  Stripe transfer and makes every state write conditional on it still being `held`, so a refund
  landing between scan and transfer wins instead of being clobbered. Nothing-transferable orders now
  settle as `skipped` (honest — no transfer was ever sent), not `released`.

Known follow-ups (from the 2026-08-16 money-path audit, in priority order): the platform-api twin
refund route still uses destination-charge semantics (`reverse_transfer: true`) and must be ported to
`refundOrder()`'s held/released branching; `charge.refunded` webhook doesn't reconcile
`payoutStatus`; `ensureConnectedAccount` has an orphan-account race (no idempotency key, insert
no-ops without returning the existing row); the UI never shows `payoutsEnabled` or Stripe's
`requirements.currently_due`, so "Payouts active" can overstate; no Express dashboard login-link for
verified creators; orders that never get a `package_shipped` webhook hold funds forever with no
sweep.
