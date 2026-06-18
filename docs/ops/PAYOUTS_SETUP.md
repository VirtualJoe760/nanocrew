# Creator payouts — setup runbook (Stripe Connect)

How to turn on the **already-built** creator-payout system so sales money flows to the creators who
make them. **The code is complete and dormant** — this is pure configuration. ~10–15 minutes, all in
your Stripe Dashboard + one Railway env var.

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

## Step 3 — Flip the switch on Railway

Set on the **app backend** (Railway — `backend-production-d7eb.up.railway.app`):

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
