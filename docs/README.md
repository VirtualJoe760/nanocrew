# Nano Crew Documentation

AI-native creator commerce: a creator talks to **Eve** to define a clothing brand → Nano Crew
auto-generates a Printful-backed shop **and** a per-brand storefront website, then keeps the website
in sync with the app's catalogue.

> **This app generates websites. The architecture *is* the product.** Read
> [`../AGENTS.md`](../AGENTS.md) "Documentation discipline" first: **every code change updates the
> docs it affects, in the same change.** Storefront-facing features are wired at the *template*
> level so every generated brand site ships them. When a doc disagrees with the code, that's a bug —
> fix it.

The docs are organized into divisions. Start here, then open the division you need.

## 🧭 Context layer (`context/`) — how to work here + the rules

The **working layer**: how to build in this repo and the rules that keep it from breaking (the rest
of `docs/` is the **domain layer** — how the product works). Start at
[`context/README.md`](context/README.md) for the canonical read-order.

| Doc | Covers |
|---|---|
| [context/CONTEXT_GUIDE.md](context/CONTEXT_GUIDE.md) | **New here? Start here.** Plain-English guide to the system + how to work with the AI agent + the skills |
| [context/PROJECT_OVERVIEW.md](context/PROJECT_OVERVIEW.md) | What it is, who for, the user flow, and the in/out-of-scope buckets |
| [context/NEVER_VIOLATE.md](context/NEVER_VIOLATE.md) | **The hard rules.** Read before any change; auto-review enforces the mechanical ones before each commit |
| [context/CODE_STANDARDS.md](context/CODE_STANDARDS.md) | TS/naming/error-handling · the pre-push gate · verify-latest-docs |
| [context/UI_TOKENS.md](context/UI_TOKENS.md) · [UI_RULES.md](context/UI_RULES.md) · [UI_REGISTRY.md](context/UI_REGISTRY.md) | The app's design tokens, reuse rules, and living component registry |

## 🏛 Architecture (`architecture/`)

| Doc | Covers |
|---|---|
| [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) | The five deployable units (app · platform-api · nanocrew-site · templates · forge) + end-to-end flow |
| [architecture/TECH_STACK.md](architecture/TECH_STACK.md) | **The full technology inventory** — every framework, dependency, AI model, service, host, and version, by unit. Keep in sync on dependency/model/deploy changes. |
| [architecture/DATABASE_PLAN.md](architecture/DATABASE_PLAN.md) | The shared multi-tenant schema (creators, stores, catalogues, products, variants, orders, credits, billing) |
| [architecture/API.md](architecture/API.md) | Endpoint reference — app routes (Cloud Run) + platform-api (Vercel) |
| [architecture/KREA_LORA.md](architecture/KREA_LORA.md) | Build plan (2026-08-15): Krea-trained avatar LoRAs for on-model shots of the actual garment. Scaffolding in `src/lib/krea.ts`, not yet wired |
| [architecture/FORGE_WATCHDOG.md](architecture/FORGE_WATCHDOG.md) | Build plan (2026-08-15): a routine that watches the `store_revisions` jobs ledger and re-engages the AI on failed/stalled forge jobs |

## 🏪 Storefront engine (`storefront/`) — how brand sites are made & served

| Doc | Covers |
|---|---|
| **[storefront/STOREFRONT_DATA_CONTRACT.md](storefront/STOREFRONT_DATA_CONTRACT.md)** | **THE doc for anything touching a brand site** — app ↔ platform-api ↔ template data flow, exact API shapes (nested variants), sync, the custom-site cutover |
| [storefront/STOREFRONT_ENGINE.md](storefront/STOREFRONT_ENGINE.md) | How sites are generated: templates, brand.json, the forge, the provision/revision queue |
| [storefront/BUILD_QUALITY.md](storefront/BUILD_QUALITY.md) | Why one generated site looks like a brand and another doesn't — the A/B, root causes (most fixed), and the remaining sighted-robot work |
| [storefront/FEATURED_PRODUCTS.md](storefront/FEATURED_PRODUCTS.md) | Creators pick featured products that headline the home + market |
| [storefront/COLLECTIONS_LOOKBOOK.md](storefront/COLLECTIONS_LOOKBOOK.md) | Collections with cover images, browsable as a lookbook (site + app) |
| [storefront/IMAGE_TARGETS.md](storefront/IMAGE_TARGETS.md) | The `data-nano-image` contract — every template tags its images so a creator can circle any image on their live site and change it |
| [storefront/TEMPLATE_AUTHORING.md](storefront/TEMPLATE_AUTHORING.md) | **"Let's create a template" starts here** — the recipe that keeps infra intact (thin-client invariant, the contract, registering a style). Read before adding/editing a template |
| [storefront/COMPONENT_SYSTEM.md](storefront/COMPONENT_SYSTEM.md) | **DESIGN** — the "jigsaw" component system: `templates/_shared` + a block manifest so templates stop duplicating UI and the forge composes blocks declaratively (folds in template-UI unification) |

## 🎨 Studio (`studio/`) — the creator's build → refine → publish arc

| Doc | Covers |
|---|---|
| [studio/README.md](studio/README.md) | Index of the studio division |
| [studio/BUILD_FLOW.md](studio/BUILD_FLOW.md) | Talk to Eve → forge builds a presentable site → refine with real assets → publish. **Honest about CURRENT vs TARGET.** |
| [studio/FORGE_AI.md](studio/FORGE_AI.md) | How our AI talks to the forge robot — Eve now authors the brief + a Master `CLAUDE.md` conditions the robot (both shipped); the remaining gap is eyes + a real quality gate. |
| [studio/DESIGN_GENERATOR.md](studio/DESIGN_GENERATOR.md) | The Design tab: products (Printful publish), model shots, scene video — the asset pipeline that replaces the forge's temporary placeholders |
| **[studio/DESIGN_SURFACES.md](studio/DESIGN_SURFACES.md)** | **The design-parity matrix** — the Design tab and Eve's pipeline are one product; a capability lands on both via the shared `src/components/designer/` seam |
| [studio/EDIT_PIPELINE.md](studio/EDIT_PIPELINE.md) | The live-site edit flow (voice → plan → generate → place → forge), its 5 checkpoints, and how to trace a failed edit in logs + DB. |
| [studio/EVE_CONTROL.md](studio/EVE_CONTROL.md) | **THE PIVOT** — Eve as the app's persistent living background + control surface, and the P3′ voice design loop. Code comments point here for the current architecture. |
| [studio/GEMINI_LIVE.md](studio/GEMINI_LIVE.md) | The live-voice stack — Eve on Gemini Live realtime speech-to-speech (`live-voice.ts` + `use-live-voice.ts`, ephemeral token, `/api/say`). SHIPPED. |
| [studio/EVE_VOICE.md](studio/EVE_VOICE.md) | How Eve TALKS — her persona is product logic living in three places (spoken interview, returning creator, typed); change one persona, change all three |
| [studio/EVE_PERSONALITY.md](studio/EVE_PERSONALITY.md) | Theory report (2026-08-19) on why Eve reads bleak — observable persona testing (`talk-to-eve.mjs`) instead of vibes; no persona changes shipped from it yet |
| [studio/FORGE_DIVERSITY.md](studio/FORGE_DIVERSITY.md) | Why every generated site looks the same — the root causes (fonts pipeline, template/hero inventory, forge latitude) + the fix tracks. Continuation of FORGE_AI.md. |
| [studio/VENUS_AVATAR.md](studio/VENUS_AVATAR.md) | Eve's avatar — the persistent orb/nucleus embodiment (the wireframe-face POC was retired; `venus-orb-scene.tsx` is her only embodiment), formant lip-sync, the liveliness recipe, and the Eve Lab. |

## 👤 Accounts (`accounts/`) — identity, orders, money

| Doc | Covers |
|---|---|
| [accounts/README.md](accounts/README.md) | Index of the accounts division |
| [accounts/AUTH_IDENTITY.md](accounts/AUTH_IDENTITY.md) | One Supabase identity mirrored by `creators`; app (local) vs platform-api (remote) token verify; store ownership + collaborators; the TARGET unified account |
| **[accounts/ACCOUNT_SURFACE.md](accounts/ACCOUNT_SURFACE.md)** | **The account parity matrix** — the account page exists in the app, on the site and in the API; change all three in the same commit, exceptions recorded with reasons |
| [accounts/ORDERS.md](accounts/ORDERS.md) | Orders keyed by `customerEmail` only; creator order views; the TARGET shopper "my orders" by email match |
| [accounts/BILLING_CREDITS.md](accounts/BILLING_CREDITS.md) | Plans/subscriptions, AI credits (accounts + ledger + costs), Stripe Connect payouts |
| [accounts/RETURNS_REFUNDS.md](accounts/RETURNS_REFUNDS.md) | The money lifecycle after checkout — the **7-day payout hold** (separate charges + transfers, ship+7d), the `return_requests` model (defect/wrong/damaged only), public returns API + creator inbox, refund mechanics, the buyer "Purchases" surface. 🚧 building |
| [accounts/EMAIL_PIPELINE.md](accounts/EMAIL_PIPELINE.md) | Every branded transactional email — Resend (reuse `notify.ts`), one verified domain with per-brand `no-reply-{slug}@mail-nano-crew.com`, the send-function contract, the lifecycle catalogue. 🚧 building |
| [accounts/POD_POLICY.md](accounts/POD_POLICY.md) | Per-provider fulfillment content policy (`src/lib/pod-policy.ts`) — catch a print-provider rejection (Printful, future suppliers) at publish, before an order is placed. Separate from generation safety. |
| [accounts/COMPLIANCE.md](accounts/COMPLIANCE.md) | US marketplace compliance — what Stripe Connect already covers (KYC/tax-ID/age) vs what we must add (age gate, INFORM Consumers Act disclosures, sales-tax/marketplace-facilitator). 1099-K, W-9, COPPA, minor contracts. Includes a phased **build plan**. Not legal advice. |

## 📱 App (`app/`)

| Doc | Covers |
|---|---|
| [app/PAGES.md](app/PAGES.md) | Every screen/section — the v1 tabs (Eve · Design · Market · Account; the `studio` route is the Eve page) + their modals. The social feed is hidden for v1 (preserved at `/feed`, returns in v2). |

## 🚀 Ops & roadmap (`ops/`, `roadmap/`)

| Doc | Covers |
|---|---|
| [ops/PRODUCTION_CHECKLIST.md](ops/PRODUCTION_CHECKLIST.md) | Go-live checklist (security, payments, env, App Store) |
| [ops/DEV_BUILD.md](ops/DEV_BUILD.md) | EAS dev-build runbook (IAP StoreKit 2, push, native Apple) |
| [ops/PLAY_STORE.md](ops/PLAY_STORE.md) | Google Play first-launch playbook (incl. FCM/Firebase for Android push) |
| [ops/APP_STORE_LISTING.md](ops/APP_STORE_LISTING.md) | App Store submission package — paste-ready listing copy, review answers, and the [YOU] steps in App Store Connect. Mirrors PLAY_STORE.md |
| [ops/PAYOUTS_SETUP.md](ops/PAYOUTS_SETUP.md) | Stripe Connect payouts runbook — turning on the already-built creator-payout system (pure configuration) |
| **[roadmap/REMAINING_FEATURES.md](roadmap/REMAINING_FEATURES.md)** | **The canonical roadmap** — what's shipped vs. still open, by blocker |
| [roadmap/LIFECYCLE_ROADMAP.md](roadmap/LIFECYCLE_ROADMAP.md) | The brand build→domain→live→Connect lifecycle (Phases A–D, all code-complete; inert until Joe's config) |

## 🗄 Archive (`archive/`) — deprecated, kept for history

Superseded or fully-executed docs, each carrying a banner that points to its living successor.

| Doc | Why archived |
|---|---|
| [archive/FEATURE_ROADMAP.md](archive/FEATURE_ROADMAP.md) | The original designer-parity plan — fully delivered; live status is [REMAINING_FEATURES.md](roadmap/REMAINING_FEATURES.md) |
| [archive/TEST_PLAN_2026-08-14.md](archive/TEST_PLAN_2026-08-14.md) | Executed one-off test pass (rig-specific, already drifted); outcomes in [ops/BUG_REPORT_2026-08-14.md](ops/BUG_REPORT_2026-08-14.md) |
| [archive/UI_QA_REPORT.md](archive/UI_QA_REPORT.md) | 2026-06-20 QA report — every open item since verified fixed or moot in code |
| [archive/VENUS_CENTRAL.md](archive/VENUS_CENTRAL.md) | The "Eve as the operating system" game plan (2026-07-05) — superseded by THE PIVOT; [studio/EVE_CONTROL.md](studio/EVE_CONTROL.md) carries the current state |

## ✋ The hard rules

The footguns that bite if forgotten (schema duplication, palette ×3, RLS, the postgres-js fetch rule,
the cascade rules…) are consolidated and verbatim-sourced in
**[context/NEVER_VIOLATE.md](context/NEVER_VIOLATE.md)** — read it before any change. Auto-review
enforces the mechanical ones before each commit.

## 🔭 Current focus & status

Not tracked here (it drifts). The live status — what's shipped vs. open — is the progress-tracker
[roadmap/REMAINING_FEATURES.md](roadmap/REMAINING_FEATURES.md); what we're focused on vs. parked is
[context/PROJECT_OVERVIEW.md](context/PROJECT_OVERVIEW.md); go-live config is
[ops/PRODUCTION_CHECKLIST.md](ops/PRODUCTION_CHECKLIST.md).
