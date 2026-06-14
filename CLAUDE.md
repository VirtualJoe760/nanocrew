@AGENTS.md

# Nanocrew

AI-native creator commerce (Expo / React Native, iOS + Android). A creator talks to **Venus**
(voice or typed AI) to define a clothing brand; Nanocrew auto-generates a Printful-backed shop
**and** a per-brand storefront website, then lets them design products, post, sell video/on-model
ads, and edit their site by chatting. Built on the proven `stephen-lawyer` create→design→Printful
loop (sibling dir).

## Read the docs first
Full, current documentation lives in **`docs/`** — read these before working:
- `docs/ARCHITECTURE.md` — the 4 deployable units, end-to-end flow, libs, data model
- `docs/PAGES.md` — every screen/section · `docs/API.md` — endpoint reference
- `docs/REMAINING_FEATURES.md` — what's open · `docs/PRODUCTION_CHECKLIST.md` — go-live
- `docs/DEV_BUILD.md` — EAS dev-build runbook · `docs/DATABASE_PLAN.md`, `docs/STOREFRONT_ENGINE.md`

## The four deployable units (one shared Supabase Postgres)
1. **Mobile app** — this repo. `src/app/**+api.ts` server routes hold the authed creator logic.
2. **platform-api** — `platform-api/` (Next.js, Vercel `nanocrew-api.vercel.app`). Public storefront API + webhooks. **`platform-api/db/schema.ts` is a COPY of `src/db/schema.ts` — re-sync it on EVERY migration.**
3. **nanocrew-templates** (sibling repo) — 4 Next.js storefront templates; `brand.json` token contract.
4. **forge** — DO droplet (`ssh nanocrew-forge`) running headless Claude; provisions + revises brand sites on working branches.

## Stack & conventions
- Expo SDK 54, expo-router, RN 0.81, React 19, TS. npm (not pnpm).
- Supabase Auth + Postgres via Drizzle. `npm run db:generate` / `db:migrate`, then sync the platform-api schema copy.
- **Authed client calls use `apiFetch()`** (`src/lib/api.ts`) — attaches the Supabase token. The designer + creator endpoints are auth + per-creator scoped (`src/lib/tenant.ts`); paid AI endpoints are credit-gated (`src/lib/credits.ts`) and rate-limited (`src/lib/rate-limit.ts`).
- **Brand = cool monochrome (paper / near-pure black) + platinum silver** (the Nano Crew asset sheet — "depth, dimension, sophistication"; NO gold), clean sans, serif only for the NC mark. Palette lives in THREE places — keep aligned: `src/constants/theme.ts` (`Colors`), `src/lib/studio-palette.ts` (Studio modals), `src/app/studio.tsx` `makePalette` (Studio screen). Individual brand storefronts keep their OWN colors — only the app chrome is monochrome.
- **Site edits are branch-based** (`revise.ts`): never edit a brand's `main` directly — change → `revision/<id>` branch → Vercel preview → creator approves → merge.
- **Commit often + push** (Joe's preference): commit at each logical milestone; verify `tsc` + `npx expo export` before pushing. End commit messages with the Co-Authored-By trailer.

## Tabs (`src/components/app-tabs.tsx`, NativeTabs + gold tint)
- `index.tsx` — **Nanocrew** feed (video-first, like/share/try-on)
- `market.tsx` — **Market** (discovery + in-app brand store)
- `studio.tsx` — **Studio** (Venus interview + brand dashboard → per-brand Console)
- `design.tsx` — **Design** (AI designer canvas → Printful publish)
- `account.tsx` — **Account** (auth, billing portal, account deletion, platform admin)

## Constraints / gotchas
- **Expo Go vs dev build**: IAP (`react-native-iap`), push remote tokens (`expo-notifications`), and critique screenshots (`react-native-view-shot`) need an EAS dev build — their server sides are done; client seams are off (`IAP_ENABLED`/`PUSH_ENABLED`). DON'T install those native deps until switching to dev builds (breaks Expo Go). See `docs/DEV_BUILD.md`.
- **Expo Go stale bundle**: only `xcrun simctl terminate booted host.exp.Exponent` + relaunch forces a fresh rebundle.
- Nano Banana can't emit alpha → magenta chroma-key (`src/lib/transparency.ts`).
- `AUTO_FIRST_DROP=1` enables server-side first-drop generation (real spend) — uses `INTERNAL_API_KEY` to call the now-authed designer routes.

## Status (2026-06-13)
All **code-side launch blockers are done** (designer auth, rate limiting, Apple Sign In, account
deletion, billing portal). Remaining go-live work is mostly Joe's config (Stripe live keys + webhooks,
Printful confirm + resale cert, Supabase Site URL revert, Meta app, the EAS build, legal). Open code:
**#24** (creator `/admin` on brand sites). See `docs/REMAINING_FEATURES.md` +
`docs/PRODUCTION_CHECKLIST.md` for the live list.

## Run
`npm run ios` · `npm run android` · `npm run web`
