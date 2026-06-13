# Nanocrew — Production / Go-Live Checklist

Everything that must be true before shipping to real users. Ordered by blocker severity.
Owner is you (Joe) unless marked **[code]** (an implementation task).

## 🔴 Launch blockers

### Security
- [ ] **[code] Authenticate the designer endpoints.** `/api/generate`, `/api/enhance`, `/api/designs`,
  `/api/compositions`, `/api/composite`, `/api/mockup`, `/api/publish`, `/api/canvas`, `/api/catalogues`,
  `/api/merge` currently run **unauthenticated** and resolve a default store. Any client could generate
  on our spend and write to / publish on the default store. Add `getUserFromRequest` + scope every
  query to the signed-in creator's store before launch.
- [ ] **[code] Rate-limit / cost-guard AI endpoints** (`/api/generate`, `/api/tryon`, `/api/video`,
  `/api/voice`) — they hit paid APIs. Gate behind auth + credits or a per-IP/per-user limit.
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
- [ ] **Revert the dev Supabase Site URL hack** (see the `supabase-auth-config-state` notes) to the
  production URL; verify OAuth redirect URLs for Google + Facebook.
- [ ] **Meta app** approved for "Continue with Facebook" (icon, privacy policy, data-deletion URL,
  category) — or hide the FB button for v1.
- [ ] **Apple Sign In** — App Store requires it if you offer other social logins on iOS.

### App store
- [ ] **EAS dev/production build** (unblocks IAP, push, critique screenshots — all three).
- [ ] **Apple IAP** must sell in-app credits/subscriptions on iOS (Apple rejects Stripe for digital
  goods). Configure App Store Connect consumables + `APPLE_IAP_SHARED_SECRET`, enable `IAP_ENABLED`.
- [ ] App icon, splash, App Store screenshots/metadata, privacy nutrition labels, age rating.
- [ ] Legal: **Privacy Policy + Terms** URLs; account/data deletion path.

## 🟠 Required infrastructure / env
Set in `.env.local` (dev) **and** the Vercel projects (app server + `platform-api`). Provisioning
**silently skips** if GitHub/VPS/Vercel vars are missing — the site just never deploys.

| Group | Vars |
|---|---|
| Data/auth | `DATABASE_URL`, `SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| AI | `GOOGLE_GENAI_API_KEY` (or `GEMINI_API_KEY`), `ELEVENLABS_API_KEY` |
| Media | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` |
| Commerce | `PRINTFUL_API_KEY`, `PRINTFUL_STORE_ID`, `PRINTFUL_CONFIRM_ORDERS=1`, `SHIPPING_FLAT_CENTS` |
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_BILLING_WEBHOOK_SECRET`, `STRIPE_PRICE_*`, `BILLING_RETURN_URL` |
| Provisioning | `GITHUB_TOKEN`, `GITHUB_OWNER`, `TEMPLATES_REPO`, `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VERCEL_TOKEN`, `PLATFORM_API_BASE` |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` |
| Flags/admin | `AUTO_FIRST_DROP`, `APPLE_IAP_SHARED_SECRET`, `PLATFORM_ADMIN_EMAILS` |

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
