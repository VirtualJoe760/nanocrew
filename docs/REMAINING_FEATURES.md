# Nanocrew — Remaining Features Audit

Status of everything still open, grouped by what unblocks it. As of 2026-06-13.
Legend: 🟢 built · 🟡 partial · ⚪ not started · 🔒 blocked on an external/native dependency.

## 1. Blocked on a native dev build (can't run in Expo Go)
These three all unlock with **one** EAS dev build. The server sides are already built.

- 🔒 **Apple IAP (in-app purchases)** — server verify (`/api/creator/billing/iap-verify`) + product
  catalogue + client seam exist. Needs: `npx expo install react-native-iap`, a dev build, App Store
  Connect consumable products, `APPLE_IAP_SHARED_SECRET`, then flip `IAP_ENABLED` in `src/lib/iap.ts`
  and fill the StoreKit calls. (Task #39)
- 🔒 **Push notifications** — `device_tokens` table, registration endpoint, and `notify.ts` delivery
  are live (revision "ready to review" fires once a token exists). Needs: `expo-notifications` + dev
  build + mint the token (`src/lib/push.ts`, `PUSH_ENABLED`). (Task #35)
- 🔒 **Critique screenshots** — drawing + voice critique works and posts to the revise flow today, but
  Claude only gets the spoken critique + region labels, not the annotated image. Needs:
  `react-native-view-shot` + dev build → capture the WebView+overlay → upload to Cloudinary → pass in
  `revise`'s `screenshots[]` (the forge already reads `briefs/screenshots/`). (Task #34)

## 2. Blocked on your account / config (no code)
- ⚪ **Stripe go-live** — create 3 recurring Prices (`STRIPE_PRICE_{STARTER,PRO,ADVANCED}`); add the
  billing webhook → `nanocrew-api.vercel.app/api/public/billing-webhook` (`STRIPE_BILLING_WEBHOOK_SECRET`);
  swap test → live keys at launch. (See PRODUCTION_CHECKLIST.)
- 🟡 **Auto first-drop** — `generateFirstDrop()` is wired into store creation but gated by
  `AUTO_FIRST_DROP=1` (real Gemini + Printful spend). Validate on one brand, then enable. (Task #26)
  **Resolved:** `first-drop.ts` now authenticates server-to-server via `INTERNAL_API_KEY` +
  `x-internal-creator` (acts as the store's creator), so set that env to enable it. (The CLI
  `scripts/first-drop.mjs` would need the same headers if used directly.)
- ⚪ **Meta (Facebook) app** — required for the "Continue with Facebook" button: icon, privacy policy,
  data-deletion URL, category, review. (Task #18)

## 3. Web billing portal
- 🟢 **Billing management** — resolved: the Account "Subscription & billing" button now opens a
  Stripe **Customer Portal** session (`/api/creator/billing/portal`) to manage/cancel/update card +
  view invoices. The Paywall's in-app Checkout covers subscribe/top-up. (Task #14)

## 4. Unbuilt product features
- ⚪ **Product-page model gallery** — on-model shots (Nano Banana) for product pages + richer feed.
  (Task #31)
- ⚪ **Veo model videos on websites** + a featured video gallery on the sites. (Task #33)
- ⚪ **Template polish** — CSS animations / premium motion in the 4 storefront templates. (Task #32)
- 🟢 **In-app platform admin** — done: Account → "Platform admin" (admin emails only) opens a
  metrics + all-stores overview. (Task #25)
- 🟡 **Creator /admin on the brand websites** — the public creator endpoints + beacon exist; the
  website-side `/admin` surface is partial. (Tasks #23/#24)
- 🟡 **Studio media uploads** — Cloudinary image upload from the composer (post cover images, etc.)
  is partial. (Task #23)

## 5. Brand / polish cleanup (small)
- ⚪ **General Sans font** — the brand typeface isn't bundled (system sans stand-in). Needs the font
  files + `expo-font`.
- 🟢 **Brand-store accent fallback** — fixed: falls back to gold `#c9a86a` (was cyan).
- ⚪ **Custom tab-bar glyphs** — tabs use SF Symbols + gold tint; true NC-monogram glyphs would need a
  custom JS tab bar.
- ⚪ **Designer endpoints auth** — `/api/generate`, `/api/compositions`, `/api/publish`, etc. are
  currently **unauthenticated** and resolve a default store. Before launch they must be authed +
  store-scoped to the signed-in creator (otherwise any client can write to the default store).
  **Security item — see PRODUCTION_CHECKLIST.**

## 6. Verification still owed (not code)
- ⚪ **On-device test pass** of the recent designer + selection features. (Task #1)
- ⚪ **End-to-end live tests:** a real subscribe → store-launch → first-drop → purchase → fulfilment
  run with live keys; a real critique → revision → approve → merge run from a device.
