# Nano Crew Documentation

AI-native creator commerce: a creator talks to **Venus** to define a clothing brand → Nano Crew
auto-generates a Printful-backed shop **and** a per-brand storefront website, then keeps the website
in sync with the app's catalogue.

> **This app generates websites. The architecture *is* the product.** Read
> [`../AGENTS.md`](../AGENTS.md) "Documentation discipline" first: **every code change updates the
> docs it affects, in the same change.** Storefront-facing features are wired at the *template*
> level so every generated brand site ships them. When a doc disagrees with the code, that's a bug —
> fix it.

The docs are organized into divisions. Start here, then open the division you need.

## 🏛 Architecture (`architecture/`)

| Doc | Covers |
|---|---|
| [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) | The four deployable units (app · platform-api · templates · forge) + end-to-end flow |
| [architecture/DATABASE_PLAN.md](architecture/DATABASE_PLAN.md) | The shared multi-tenant schema (creators, stores, catalogues, products, variants, orders, credits, billing) |
| [architecture/API.md](architecture/API.md) | Endpoint reference — app routes (Railway) + platform-api (Vercel) |

## 🏪 Storefront engine (`storefront/`) — how brand sites are made & served

| Doc | Covers |
|---|---|
| **[storefront/STOREFRONT_DATA_CONTRACT.md](storefront/STOREFRONT_DATA_CONTRACT.md)** | **THE doc for anything touching a brand site** — app ↔ platform-api ↔ template data flow, exact API shapes (nested variants), sync, the custom-site cutover |
| [storefront/STOREFRONT_ENGINE.md](storefront/STOREFRONT_ENGINE.md) | How sites are generated: templates, brand.json, the forge, the provision/revision queue |
| [storefront/BUILD_QUALITY.md](storefront/BUILD_QUALITY.md) | Why one generated site looks like a brand and another doesn't — the A/B, root causes (most fixed), and the remaining sighted-robot work |
| [storefront/FEATURED_PRODUCTS.md](storefront/FEATURED_PRODUCTS.md) | Creators pick featured products that headline the home + market |
| [storefront/COLLECTIONS_LOOKBOOK.md](storefront/COLLECTIONS_LOOKBOOK.md) | Collections with cover images, browsable as a lookbook (site + app) |
| [storefront/TEMPLATE_AUTHORING.md](storefront/TEMPLATE_AUTHORING.md) | **"Let's create a template" starts here** — the recipe that keeps infra intact (thin-client invariant, the contract, registering a style). Read before adding/editing a template |
| [storefront/COMPONENT_SYSTEM.md](storefront/COMPONENT_SYSTEM.md) | **DESIGN** — the "jigsaw" component system: `templates/_shared` + a block manifest so templates stop duplicating UI and the forge composes blocks declaratively (folds in template-UI unification) |

## 🎨 Studio (`studio/`) — the creator's build → refine → publish arc

| Doc | Covers |
|---|---|
| [studio/README.md](studio/README.md) | Index of the studio division |
| [studio/BUILD_FLOW.md](studio/BUILD_FLOW.md) | Talk to Venus → forge builds a presentable site → refine with real assets → publish. **Honest about CURRENT vs TARGET.** |
| [studio/FORGE_AI.md](studio/FORGE_AI.md) | How our AI talks to the forge robot — Venus now authors the brief + a Master `CLAUDE.md` conditions the robot (both shipped); the remaining gap is eyes + a real quality gate. |
| [studio/DESIGN_GENERATOR.md](studio/DESIGN_GENERATOR.md) | The Design tab: products (Printful publish), model shots, scene video — the asset pipeline that replaces the forge's temporary placeholders |
| [studio/EDIT_PIPELINE.md](studio/EDIT_PIPELINE.md) | The live-site edit flow (voice → plan → generate → place → forge), its 5 checkpoints, and how to trace a failed edit in logs + DB. |

## 👤 Accounts (`accounts/`) — identity, orders, money

| Doc | Covers |
|---|---|
| [accounts/README.md](accounts/README.md) | Index of the accounts division |
| [accounts/AUTH_IDENTITY.md](accounts/AUTH_IDENTITY.md) | One Supabase identity mirrored by `creators`; app (local) vs platform-api (remote) token verify; store ownership + collaborators; the TARGET unified account |
| [accounts/ORDERS.md](accounts/ORDERS.md) | Orders keyed by `customerEmail` only; creator order views; the TARGET shopper "my orders" by email match |
| [accounts/BILLING_CREDITS.md](accounts/BILLING_CREDITS.md) | Plans/subscriptions, AI credits (accounts + ledger + costs), Stripe Connect payouts |
| [accounts/RETURNS_REFUNDS.md](accounts/RETURNS_REFUNDS.md) | The money lifecycle after checkout — the **7-day payout hold** (separate charges + transfers, ship+7d), the `return_requests` model (defect/wrong/damaged only), public returns API + creator inbox, refund mechanics, the buyer "Purchases" surface. 🚧 building |
| [accounts/EMAIL_PIPELINE.md](accounts/EMAIL_PIPELINE.md) | Every branded transactional email — Resend (reuse `notify.ts`), one verified domain with per-brand `no-reply-{slug}@mail-nano-crew.com`, the send-function contract, the lifecycle catalogue. 🚧 building |
| [accounts/POD_POLICY.md](accounts/POD_POLICY.md) | Per-provider fulfillment content policy (`src/lib/pod-policy.ts`) — catch a print-provider rejection (Printful, future suppliers) at publish, before an order is placed. Separate from generation safety. |
| [accounts/COMPLIANCE.md](accounts/COMPLIANCE.md) | US marketplace compliance — what Stripe Connect already covers (KYC/tax-ID/age) vs what we must add (age gate, INFORM Consumers Act disclosures, sales-tax/marketplace-facilitator). 1099-K, W-9, COPPA, minor contracts. Includes a phased **build plan**. Not legal advice. |

## 📱 App (`app/`)

| Doc | Covers |
|---|---|
| [app/PAGES.md](app/PAGES.md) | Every screen/section — the v1 tabs (Studio · Design · Market · Account) + their modals. The social feed is hidden for v1 (preserved at `/feed`, returns in v2). |

## 🚀 Ops & roadmap (`ops/`, `roadmap/`)

| Doc | Covers |
|---|---|
| [ops/PRODUCTION_CHECKLIST.md](ops/PRODUCTION_CHECKLIST.md) | Go-live checklist (security, payments, env, App Store) |
| [ops/DEV_BUILD.md](ops/DEV_BUILD.md) | EAS dev-build runbook (IAP StoreKit 2, push, native Apple) |
| [ops/PLAY_STORE.md](ops/PLAY_STORE.md) | Google Play first-launch playbook (incl. FCM/Firebase for Android push) |
| **[roadmap/REMAINING_FEATURES.md](roadmap/REMAINING_FEATURES.md)** | **The canonical roadmap** — what's shipped vs. still open, by blocker |
| [roadmap/LIFECYCLE_ROADMAP.md](roadmap/LIFECYCLE_ROADMAP.md) | The brand build→domain→live→Connect lifecycle (Phases A–D, all code-complete; inert until Joe's config) |
| [roadmap/FEATURE_ROADMAP.md](roadmap/FEATURE_ROADMAP.md) | Historical — the original designer-parity plan (delivered). Kept for context; see REMAINING_FEATURES for live status. |

## ✋ Two invariants that bite if forgotten

1. **Schema is duplicated.** `platform-api/db/schema.ts` is a copy of `src/db/schema.ts` — change
   both on every migration (see [architecture/DATABASE_PLAN.md](architecture/DATABASE_PLAN.md)).
2. **The brand palette lives in three files** (`src/constants/theme.ts`, `src/lib/studio-palette.ts`,
   `src/app/studio.tsx`) — change all three together.

## 🔭 Current focus

The app lands on **Studio** (the social feed is hidden for v1, preserved at `/feed`, back in v2) and
is close to production-ready on TestFlight. Recent work has shipped:

- **Mini-CMS** — Studio brand console → **✦ Customize** (`SiteEditor`) edits site copy/colors/fonts
  live with **no rebuild** (`stores.site_config`, migration 0018 → `POST /api/creator/site-config` →
  public `GET /api/public/stores/:slug/site-config`, read by all 4 templates' `lib/site-config.ts`).
  See [storefront/STOREFRONT_DATA_CONTRACT.md](storefront/STOREFRONT_DATA_CONTRACT.md).
- **✦ Enhance** — every mini-CMS text box gets an AI rewrite in the brand voice
  (`POST /api/creator/enhance-copy`, gemini-2.5-flash, free + rate-limited).
- **SEO layer** in all 4 templates — canonical URLs + Organization/Product/BlogPosting JSON-LD,
  OpenGraph/Twitter, `sitemap.ts` + `robots.ts` (`lib/seo.ts`). See
  [storefront/STOREFRONT_ENGINE.md](storefront/STOREFRONT_ENGINE.md) ("SEO").
- **Build-quality work** (the prior focus) is largely shipped: Venus now *authors* the build brief
  (`authorBrandBrief`, gemini-2.5-pro) and a **Master `CLAUDE.md`** conditions the forge robot
  ([studio/FORGE_AI.md](studio/FORGE_AI.md)). What remains open: giving the robot **eyes + a
  self-critique loop** and a real quality gate (no more silent `|| true` ready-flip) — see
  [storefront/BUILD_QUALITY.md](storefront/BUILD_QUALITY.md).
- **App-only Publish** — selling is decoupled from websites: `POST /api/creator/stores/:slug/publish`
  lists a brand in the in-app Market + on `nanocrew.app/b/<slug>` with only an active plan + a
  published product (a custom domain is now a separate Pro upgrade). See
  [studio/BUILD_FLOW.md](studio/BUILD_FLOW.md) + [storefront/STOREFRONT_DATA_CONTRACT.md](storefront/STOREFRONT_DATA_CONTRACT.md).
- **Apple IAP (StoreKit 2)** shipped — plans + credit packs verify via the App Store Server API; the
  **mini-CMS hex color picker**, **durable real-time build status**, **comp/internal accounts**
  (never billed), and the **Supabase RLS lockdown** are all in. Credit pricing is finalized at a flat
  $0.01/cr floor ([accounts/BILLING_CREDITS.md](accounts/BILLING_CREDITS.md)).

The remaining open work is mostly Joe's account/config (notably **switching platform-api to the live
Stripe key** — commerce is still on a test key — plus Connect + domain-buy contact) and end-to-end
live verification — tracked in [roadmap/REMAINING_FEATURES.md](roadmap/REMAINING_FEATURES.md) and
[ops/PRODUCTION_CHECKLIST.md](ops/PRODUCTION_CHECKLIST.md).
