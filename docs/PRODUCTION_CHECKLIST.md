# Nanocrew — Production / Go-Live Checklist

Everything that must be true before shipping to real users. Ordered by blocker severity.
Owner is you (Joe) unless marked **[code]** (an implementation task).

## 🔴 Launch blockers

### Security
- [x] **[code] Authenticate the designer endpoints.** ✅ Done (2026-06-13). All designer routes now
  require a Supabase bearer token and scope to the creator's store via `src/lib/tenant.ts`
  (`getCreatorStore` / `assertCatalogueOwner` / `assertCompositionOwner` / `assertDesignOwner`); the
  client sends the token through `apiFetch`. The server-to-server first-drop path is handled by an
  internal-service key (`INTERNAL_API_KEY` + `x-internal-creator` header) so it authenticates as the
  store's creator — set `INTERNAL_API_KEY` to enable `AUTO_FIRST_DROP`.
- [x] **[code] Rate-limit the AI endpoints** ✅ Done (2026-06-13). A DB-backed fixed-window limiter
  (`src/lib/rate-limit.ts` + `rate_limits` table) guards generate/merge/composite/tryon (gen),
  voice (voice), enhance/idea (ai), mockup/publish (pf) per creator/min; `/api/video` is already
  credit-gated. Over-limit returns `429` with `Retry-After`. tryon is now authed too.
- [ ] Rotate any secrets that have been pasted in chat/commits; confirm `.env*` is git-ignored.
- [ ] Confirm **Supabase RLS** posture: the app uses server routes with the service path, but verify no
  table is publicly writable via the anon key.

### Payments (Stripe — currently TEST keys)
- [ ] Create the platform's **live** Stripe keys; set `STRIPE_SECRET_KEY` (app + platform-api).
- [ ] Create 3 recurring Prices → `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ADVANCED`.
- [ ] Commerce webhook → `…/api/public/stripe-webhook` → `STRIPE_WEBHOOK_SECRET`.
- [ ] Billing webhook → `…/api/public/billing-webhook` (events: `checkout.session.completed`,
  `invoice.paid`, `customer.subscription.updated/deleted`) → `STRIPE_BILLING_WEBHOOK_SECRET`.
- [ ] Turn on Stripe receipts/emails.
- [ ] **Stripe Connect** (per-creator payouts + application fee) — schema is ready
  (`connectedAccounts`, `orders.application_fee_cents`); onboarding flow not yet built. Decide whether
  v1 settles to the platform and pays creators manually, or Connect is required at launch.

### Fulfilment (Printful)
- [ ] Set `PRINTFUL_CONFIRM_ORDERS=1` (paid orders auto-confirm instead of staying drafts).
- [ ] File a **resale certificate** with Printful (kills sales tax on our cost) + consider Printful
  **Growth** membership (~20% off blanks). See unit economics in STOREFRONT_ENGINE.md.
- [ ] Verify the `printful-webhook` is registered and tracking flows back to orders.

### Auth / config
- [x] **Supabase Site URL + redirects** ✅ (2026-06-15) Site URL → the Railway production URL;
  redirect allow-list includes `nanocrew://auth`, `nanocrew://**`, the Railway URL, `exp://**`.
- [x] **Facebook hidden for v1** ✅ (2026-06-15) — button removed + Supabase Facebook provider disabled
  (credentials retained). Re-enable later only with a Live, reviewed Meta app.
- [x] **Apple Sign In** ✅ (2026-06-15) — switched to NATIVE (`expo-apple-authentication` →
  `signInWithIdToken`, no client secret to expire). Supabase Apple provider enabled with bundle id
  `com.nanocrew.app`; App ID has the Sign-in-with-Apple capability. Works once build #12 lands.

### App store
- [ ] **EAS dev/production build** (unblocks IAP, push, critique screenshots — all three). Scaffolding
  is in (`eas.json`, bundle id `com.nanocrew.app`); follow **[DEV_BUILD.md](DEV_BUILD.md)** for the
  native-dep installs + wiring (don't install them while you still want Expo Go).
- [ ] **Apple IAP** must sell in-app credits/subscriptions on iOS (Apple rejects Stripe for digital
  goods). Configure App Store Connect consumables + `APPLE_IAP_SHARED_SECRET`, enable `IAP_ENABLED`.
- [ ] App icon, splash, App Store screenshots/metadata, privacy nutrition labels, age rating.
- [x] **Account/data deletion path** ✅ Code done (2026-06-13) — "Delete account" in Account →
  `DELETE /api/me` wipes the creator + all cascaded data; best-effort deletes the Supabase auth
  identity when `SUPABASE_SERVICE_ROLE_KEY` is set (set it so the auth user is removed too).
  *Note: live Printful products + active Stripe subs aren't auto-cancelled — handle out of band.*
- [ ] Legal: **Privacy Policy + Terms** URLs (host them; link from the app/App Store/Meta).

## 🟠 Required infrastructure / env
Set in `.env.local` (dev) **and** the Vercel projects (app server + `platform-api`). Provisioning
**silently skips** if GitHub/VPS/Vercel vars are missing — the site just never deploys.

| Group | Vars |
|---|---|
| Data/auth | `DATABASE_URL`, `SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (auth-user deletion) |
| AI | `GOOGLE_GENAI_API_KEY` (or `GEMINI_API_KEY`), `ELEVENLABS_API_KEY` |
| Media | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` |
| Commerce | `PRINTFUL_API_KEY`, `PRINTFUL_STORE_ID`, `PRINTFUL_CONFIRM_ORDERS=1`, `SHIPPING_FLAT_CENTS` |
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_BILLING_WEBHOOK_SECRET`, `STRIPE_PRICE_*`, `BILLING_RETURN_URL` |
| Provisioning | `GITHUB_TOKEN`, `GITHUB_OWNER`, `TEMPLATES_REPO`, `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VERCEL_TOKEN`, `PLATFORM_API_BASE` |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` |
| Flags/admin | `AUTO_FIRST_DROP`, `APPLE_IAP_SHARED_SECRET`, `PLATFORM_ADMIN_EMAILS`, `INTERNAL_API_KEY` (server-to-server first-drop) |

- [ ] On **every migration**: regenerate, apply, and **copy `src/db/schema.ts` → `platform-api/db/schema.ts`**.
- [ ] Confirm the forge VPS is reachable and `VERCEL_TOKEN` deploys (otherwise "Build site" pushes a
  repo but never goes live).

## 🟡 Pre-launch validation (run these end-to-end, on a device)
- [ ] Sign up → interview (voice **and** typed) → **Create my store** → paywall → subscribe →
  store provisions → site deploys.
- [ ] Enable `AUTO_FIRST_DROP` on one brand; confirm ~4 products land.
- [ ] Design → generate → compose → mockup → **publish** → product appears on feed + shop + site.
- [ ] Storefront purchase with a real card → webhook flips to paid → Printful order created → tracking.
- [ ] Critique (chat + draw/voice) → revision branch → preview → **approve** → merges to main.
- [ ] Credits debit/refund correct; insufficient-credits paths show the paywall.
- [ ] Light **and** dark mode read correctly on every tab + modal.

## 🟢 Nice-to-have before/just-after launch
- [ ] Bundle **General Sans**; fix the brand-store cyan fallback → gold; custom tab glyphs.
- [ ] In-app platform admin screen; website `/admin`; Studio media uploads.
- [ ] On-model galleries (#31), site Veo videos (#33), template animations (#32).
- [ ] Error monitoring (Sentry) + basic analytics; uptime checks on `platform-api`.
