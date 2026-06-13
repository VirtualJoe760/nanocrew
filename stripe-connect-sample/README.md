# Nanocrew — Stripe Connect sample

A self-contained, runnable reference for the Connect integration we'll fold into the real app.
**Not production** — it uses an in-memory store and serves plain HTML. It exists to (a) make the
business model concrete and (b) be a testbed for the exact API calls before they go into
`platform-api` + `/api/store`.

## The business model (why these calls)
Nanocrew is a Stripe **Platform** (direct charges). Two revenue streams:

1. **SaaS subscription** — Nanocrew charges each **brand** a recurring plan fee. The brand is the
   customer; with V2 accounts the connected-account id is the `customer_account`.
2. **Marketplace commission** — each storefront sale is a **direct charge on the brand's account**
   with an `application_fee_amount` that splits Nanocrew's cut off automatically. The brand is the
   merchant of record (owns refunds/disputes; Stripe fees come off its side).

Flow of funds: customer pays → brand → brand pays Stripe fee → brand pays application fee (Nanocrew)
→ monthly subscription fee (brand → Nanocrew).

## What it demonstrates
| Step | Endpoint | Stripe call |
|---|---|---|
| Create connected account | `POST /accounts` | `v2.core.accounts.create` (no top-level `type`) |
| Onboard | `POST /account-links` | `v2.core.accountLinks.create` (hosted) |
| Live status | `GET /account-status` | `v2.core.accounts.retrieve` (`configuration.merchant` + `requirements`) |
| Create product on the brand | `POST /products` | `products.create(..., { stripeAccount })` |
| Storefront | `GET /storefront/:accountId` | `products.list(..., { stripeAccount })` |
| Buy (direct charge + fee) | `POST /buy` | `checkout.sessions.create({ payment_intent_data.application_fee_amount }, { stripeAccount })` |
| Subscribe the brand | `POST /subscribe` | `checkout.sessions.create({ customer_account, mode:'subscription' })` |
| Manage billing | `POST /billing-portal` | `billingPortal.sessions.create({ customer_account })` |
| Account webhooks (THIN/v2) | `POST /webhooks/account` | `parseEventNotification` → `related_object.id` / `fetchEvent()` |
| Subscription webhooks (regular) | `POST /webhooks/subscriptions` | `webhooks.constructEvent` |

## Run
```bash
cd stripe-connect-sample
cp .env.example .env        # fill STRIPE_SECRET_KEY (test mode)
npm install
npm run dev                 # → http://localhost:4242
```
Onboarding uses Stripe test data (use the test SSN `000-00-0000`, any future date, etc.).
For webhooks, run the two `stripe listen` commands in `.env.example` and paste the printed secrets.

## How this maps onto the real app (the integration plan)
- **`db.accountByUser` → the `connected_accounts` table** (keyed by creator/store).
- **`POST /accounts` → `/api/store`**: create the brand's connected account at brand establishment
  ("born connecting"); store `stripeAccountId`.
- **Onboarding link** → surfaced in the app (Account/Studio) so the creator finishes verification.
- **`getAccountStatus` → the go-live gate**: a store can't go `live` until `card_payments` is `active`.
- **`POST /buy` → `platform-api` storefront checkout**: switch the existing platform-account checkout
  to a **direct charge on the brand's account + `application_fee_amount`** (the schema already has
  `orders.application_fee_cents`).
- **`/subscribe` + `/billing-portal`** → reconcile with the existing creator plan billing.
- **Account webhooks** → keep `connected_accounts.{chargesEnabled,payoutsEnabled,detailsSubmitted}` fresh.

> Note: this sample is intentionally outside the app's build (its own `package.json`). Don't `npm install`
> it from the repo root.
