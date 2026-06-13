# Nanocrew Documentation

AI-native creator commerce: talk to **Venus** to build a clothing brand → an auto-generated
Printful shop **and** a per-brand storefront website.

## Start here
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — the four deployable units, end-to-end flow, libraries, data model.
- **[PAGES.md](PAGES.md)** — every screen and section (5 tabs + Studio modals), what each does.
- **[API.md](API.md)** — full endpoint reference (app routes + platform-api), grouped.

## Plan & ship
- **[REMAINING_FEATURES.md](REMAINING_FEATURES.md)** — what's still open, grouped by blocker.
- **[PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md)** — go-live checklist (security, payments, env, app store).

## Deep dives (pre-existing)
- **[DATABASE_PLAN.md](DATABASE_PLAN.md)** — multi-tenant schema design.
- **[STOREFRONT_ENGINE.md](STOREFRONT_ENGINE.md)** — templates, forge, brief protocol, commerce, unit economics.
- **[FEATURE_ROADMAP.md](FEATURE_ROADMAP.md)** — designer parity + phase history.

> Keep `platform-api/db/schema.ts` in sync with `src/db/schema.ts` on every migration.
> The brand palette lives in three places (`constants/theme.ts`, `lib/studio-palette.ts`,
> `app/studio.tsx`) — change all three together.
