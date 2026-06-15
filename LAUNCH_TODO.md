# Nanocrew — Launch To-Do

_Last updated: 2026-06-15. Mostly your account/billing actions now — the code side is largely done._

## 🚨 Do now (P0)

- [ ] **Railway billing** — the project is on a trial ("30 days or $4.99 left"). When it lapses the
      backend (`backend-production-d7eb.up.railway.app`) goes offline and the whole app dies.
      → Railway → Settings → add a payment method / pick a plan.
- [ ] **Verify build #12 on device** (TestFlight, once it finishes) — test **native "Continue with
      Apple"** and **push notifications** on-device. Confirms #9 + #13 too.
- [ ] **Create one test brand in Studio** — your account is now Pro, so provisioning is unlocked and
      the forge worker is verified ready. This confirms a real storefront site deploys end-to-end
      (uses a little AI credit). _Watch the store flip to `ready` with a Vercel URL._

## 💳 Commerce go-live (P1 — do these together)

- [ ] **Stripe go-live** — switch test→live keys; create the 3 subscription prices + credit-pack
      prices (`scripts/setup-stripe-plans.mjs`); register both webhooks (orders + subscriptions) with
      signing secrets; set `SHIPPING_FLAT_CENTS`. _I can drive this with you._
  - [ ] **Before go-live:** delete the manual Pro grant so it doesn't shadow your real subscription:
        `delete from subscriptions where creator_id='c60f23f8-f804-4ecb-8018-36e90433a96e' and stripe_customer_id='MANUAL_TEST_GRANT';`
- [ ] **Stripe Connect** — enable creator payouts (destination charges).
- [ ] **Printful go-live** — set `PRINTFUL_CONFIRM_ORDERS=1` on platform-api (turns drafts into real
      charged orders — do this WITH Stripe, not before); verify `PRINTFUL_API_KEY`/`STORE_ID` on
      Vercel; file a **resale certificate**; set `PRINTFUL_WEBHOOK_TOKEN` + append `?token=…` to the
      webhook URL in Printful's dashboard (the route already rejects forged calls once set).

## 🍎 App Store submission (P1)

- [ ] **Apple IAP** (#10) — App-Store blocker for selling credits/subscriptions. Needs a decision:
      pin `react-native-iap` to a v12 (matches the server's legacy `verifyReceipt`) **or** update the
      server to the StoreKit-2 App Store Server API (matches v15). Then wire it, create the 3
      consumables in ASC + `APPLE_IAP_SHARED_SECRET`, and sandbox-test. _Best done together — won't
      wire it blind since it's revenue-critical._
- [ ] **App Store listing assets** — screenshots, description, keywords, age rating. Privacy URL is
      ready: `https://nanocrew-api.vercel.app/privacy`.
- [ ] **Legal placeholders** — in the live Privacy/Terms, set the legal entity name, governing-law
      jurisdiction, and a real support email; have counsel review.

## ✅ Done this session (2026-06-14/15)

- [x] Supabase production auth — Site URL, redirects, **native Sign in with Apple** (no secret)
- [x] Apple App ID — all 3 capabilities (IAP, Push, Apple); old profile invalidated → clean regen
- [x] **Railway GitHub auto-deploy** — reconnected + enabled (push → deploy)
- [x] **Privacy + Terms** live (`/privacy`, `/terms`) + linked in-app
- [x] **Facebook** hidden for v1
- [x] **General Sans** font bundled + wired (ships build #13+)
- [x] **Security pass** — SSRF guard, merge IDOR fix, constant-time key, Printful webhook token
- [x] **Provisioning** verified end-to-end ready (Pro granted, forge worker healthy)
- [x] Push notifications wired; build #12 (native Apple + push) building/submitted
- [x] Earnings cockpit → monochrome; Studio media uploads; INTERNAL_API_KEY

## Notes

- **Expo Go is retired** for this project as of build #12 (native modules installed) — use dev builds.
- The full granular task list lives in this session's task tracker.
