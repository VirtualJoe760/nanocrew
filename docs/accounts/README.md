# Accounts

Everything about **who a person is** to Nano Crew and **what that identity can do** — sign in,
own a brand, place an order, pay for a plan, spend credits, get paid out. Three docs:

| Doc | Covers | State |
|---|---|---|
| [AUTH_IDENTITY.md](AUTH_IDENTITY.md) | The identity model — one Supabase auth user mirrored by `creators`; how the app and platform-api each verify tokens; store ownership + collaborators; storefront `/admin` auth. The CURRENT model vs. the TARGET unified account. | ✅ current (2026-06-15) |
| [ORDERS.md](ORDERS.md) | The commerce identity — orders are keyed by `customerEmail` only (no user FK). How checkout creates an order, how the creator sees their store's orders, and the TARGET shopper "my orders". | ✅ current (2026-06-15) |
| [BILLING_CREDITS.md](BILLING_CREDITS.md) | Creator money — plans/subscriptions (free/starter/pro/advanced), AI credits (accounts + ledger + per-op costs), and creator payouts via Stripe Connect. | ✅ current (2026-06-15) |

## The one fact to anchor on

There is **one identity**: a Supabase Auth user. The `creators` table mirrors it
(`creators.id = auth.users.id`, `email` UNIQUE — `src/db/schema.ts`). Everything a *creator*
owns hangs off that id (stores, credits, subscription, connected account). **Shoppers** are
NOT yet first-class accounts — an order today is keyed only by `customerEmail`, with no user
FK. The target work (the user's task list #21–28) is to make that single Supabase identity work
**everywhere** — the app and every brand site — so signing up on a brand site creates a real
Nano Crew account and "my orders" resolves by email match. See each doc's "Target" section.

## Where the code lives

- **Identity / token verify**: `src/lib/auth.ts` (app, local ES256/JWKS) ·
  `platform-api/lib/auth.ts` (platform-api, remote `/auth/v1/user`) · `src/lib/oauth.ts` +
  `src/hooks/use-auth.ts` (client sign-in) · `src/lib/tenant.ts` (store scoping).
- **Orders**: `platform-api/app/api/public/checkout/route.ts` (create) ·
  `platform-api/app/api/public/stripe-webhook/route.ts` (fill email) ·
  `src/app/api/creator/orders+api.ts` + `/stats` + `/orders/[id]/refund` (creator view).
- **Billing/credits/payouts**: `src/lib/billing.ts`, `src/lib/credits.ts`, `src/lib/connect.ts`
  and their `src/app/api/creator/{subscription,credits,connect,billing/*}+api.ts` routes.
</content>
</invoke>
