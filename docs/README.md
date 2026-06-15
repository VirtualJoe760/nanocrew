# Nanocrew Documentation

AI-native creator commerce: a creator talks to **Venus** to define a clothing brand → Nanocrew
auto-generates a Printful-backed shop **and** a per-brand storefront website, then keeps the website
in sync with the app's catalogue.

> **This app generates websites. The architecture *is* the product.** Read
> [`../AGENTS.md`](../AGENTS.md) "Documentation discipline" first: **every code change updates the
> docs it affects, in the same change.** Storefront-facing features are wired at the *template*
> level so every generated brand site ships them. When a doc disagrees with the code, that's a bug —
> fix it.

## 🧭 Core system specs (how it's *supposed* to work — source of truth)

| Doc | Covers | State |
|---|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | The four deployable units + end-to-end flow | ⚠️ refresh (Railway move, forge-worker queue) |
| [DATABASE_PLAN.md](DATABASE_PLAN.md) | Multi-tenant schema (stores, catalogues, products, variants, credits, billing) | ⚠️ refresh |
| [STOREFRONT_ENGINE.md](STOREFRONT_ENGINE.md) | How sites are generated: templates, brand.json, the forge, provisioning, revision | ⚠️ refresh (queue, not SSH) |
| **[STOREFRONT_DATA_CONTRACT.md](STOREFRONT_DATA_CONTRACT.md)** | **App ↔ platform-api ↔ template data flow, exact API shapes, sync, cutover** | ✅ current (2026-06-15) |
| [API.md](API.md) | Endpoint reference (app routes + platform-api) | ⚠️ refresh |
| [PAGES.md](PAGES.md) | Every screen/section (5 tabs + Studio modals) | ⚠️ refresh (Account rework, in-app store) |

## 🧩 Feature specs (what to build, designed at the template level)

| Doc | |
|---|---|
| [FEATURED_PRODUCTS.md](FEATURED_PRODUCTS.md) | Creators pick featured products that headline the home + market |
| [COLLECTIONS_LOOKBOOK.md](COLLECTIONS_LOOKBOOK.md) | Collections with cover images, browsable as a lookbook (site + app) |

## 🚀 Plan & ship

- [REMAINING_FEATURES.md](REMAINING_FEATURES.md) — what's still open, by blocker.
- [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) — go-live checklist (security, payments, env, App Store).
- [DEV_BUILD.md](DEV_BUILD.md) — EAS dev-build runbook (IAP, push, native Apple).
- [FEATURE_ROADMAP.md](FEATURE_ROADMAP.md) · [LIFECYCLE_ROADMAP.md](LIFECYCLE_ROADMAP.md) — history + phases.

## ✋ Two invariants that bite if forgotten

1. **Schema is duplicated.** `platform-api/db/schema.ts` is a copy of `src/db/schema.ts` — change
   both on every migration.
2. **The brand palette lives in three files** (`src/constants/theme.ts`, `src/lib/studio-palette.ts`,
   `src/app/studio.tsx`) — change all three together.

---

### ⚠️ "refresh" means the doc has drifted from the code

Those docs were accurate when written but predate recent changes (the backend moved to Railway;
provisioning now enqueues to the forge-worker queue instead of SSHing; the Account page + in-app
store were reworked; storefront auto-revalidation was added). Refresh them as you touch the
corresponding systems — don't trust a ⚠️ doc's details without checking the code.
