# Nanocrew Documentation

AI-native creator commerce: a creator talks to **Venus** to define a clothing brand → Nanocrew
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
| [storefront/BUILD_QUALITY.md](storefront/BUILD_QUALITY.md) | Why one generated site looks like a brand and another doesn't — the A/B, root causes, the target |
| [storefront/FEATURED_PRODUCTS.md](storefront/FEATURED_PRODUCTS.md) | Creators pick featured products that headline the home + market |
| [storefront/COLLECTIONS_LOOKBOOK.md](storefront/COLLECTIONS_LOOKBOOK.md) | Collections with cover images, browsable as a lookbook (site + app) |

## 🎨 Studio (`studio/`) — the creator's build → refine → publish arc

| Doc | Covers |
|---|---|
| [studio/README.md](studio/README.md) | Index of the studio division |
| [studio/BUILD_FLOW.md](studio/BUILD_FLOW.md) | Talk to Venus → forge builds a presentable site → refine with real assets → publish. **Honest about CURRENT vs TARGET.** |
| [studio/FORGE_AI.md](studio/FORGE_AI.md) | How our AI talks to the forge robot — the mail-merge brief, the unconditioned robot, the swallowed failures, and the plan. **Heart of the build-quality effort.** |
| [studio/DESIGN_GENERATOR.md](studio/DESIGN_GENERATOR.md) | The Design tab: products (Printful publish), model shots, scene video — the asset pipeline that replaces the forge's temporary placeholders |

## 👤 Accounts (`accounts/`) — identity, orders, money

| Doc | Covers |
|---|---|
| [accounts/README.md](accounts/README.md) | Index of the accounts division |
| [accounts/AUTH_IDENTITY.md](accounts/AUTH_IDENTITY.md) | One Supabase identity mirrored by `creators`; app (local) vs platform-api (remote) token verify; store ownership + collaborators; the TARGET unified account |
| [accounts/ORDERS.md](accounts/ORDERS.md) | Orders keyed by `customerEmail` only; creator order views; the TARGET shopper "my orders" by email match |
| [accounts/BILLING_CREDITS.md](accounts/BILLING_CREDITS.md) | Plans/subscriptions, AI credits (accounts + ledger + costs), Stripe Connect payouts |

## 📱 App (`app/`)

| Doc | Covers |
|---|---|
| [app/PAGES.md](app/PAGES.md) | Every screen/section — the 5 tabs (Feed · Market · Studio · Design · Account) + their modals |

## 🚀 Ops & roadmap (`ops/`, `roadmap/`)

| Doc | Covers |
|---|---|
| [ops/PRODUCTION_CHECKLIST.md](ops/PRODUCTION_CHECKLIST.md) | Go-live checklist (security, payments, env, App Store) |
| [ops/DEV_BUILD.md](ops/DEV_BUILD.md) | EAS dev-build runbook (IAP, push, native Apple) |
| [roadmap/REMAINING_FEATURES.md](roadmap/REMAINING_FEATURES.md) | What's still open, by blocker |
| [roadmap/FEATURE_ROADMAP.md](roadmap/FEATURE_ROADMAP.md) · [roadmap/LIFECYCLE_ROADMAP.md](roadmap/LIFECYCLE_ROADMAP.md) | History + phases |

## ✋ Two invariants that bite if forgotten

1. **Schema is duplicated.** `platform-api/db/schema.ts` is a copy of `src/db/schema.ts` — change
   both on every migration (see [architecture/DATABASE_PLAN.md](architecture/DATABASE_PLAN.md)).
2. **The brand palette lives in three files** (`src/constants/theme.ts`, `src/lib/studio-palette.ts`,
   `src/app/studio.tsx`) — change all three together.

## 🔭 Current focus — build quality

The pipeline runs end-to-end, but the **quality of what the forge builds** is the open problem:
generated sites look like bare templates, not brands (see
[storefront/BUILD_QUALITY.md](storefront/BUILD_QUALITY.md) and
[studio/FORGE_AI.md](studio/FORGE_AI.md)). The fix — a masterful AI-authored prompt + a conditioned,
sighted forge robot + a build→refine→publish arc — is tracked as the build-quality epic in the
project task list.
