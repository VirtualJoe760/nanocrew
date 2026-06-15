@AGENTS.md

# Nanocrew

AI-native creator commerce (Expo / React Native, iOS + Android). A creator talks to **Venus**
(voice or typed AI) to define a clothing brand; Nanocrew auto-generates a Printful-backed shop
**and** a per-brand storefront website, then lets them design products, post, sell video/on-model
ads, and edit their site by chatting. Built on the proven `stephen-lawyer` create→design→Printful
loop (sibling dir).

## Read the docs first — and update them as you build
Documentation is a first-class division in **`docs/`**. Start at **`docs/README.md`** (the map) and
**`AGENTS.md` "Documentation discipline"**: **every code change updates the docs it affects, in the
same change**, and storefront-facing features are wired at the *template* level so every generated
brand site ships them.
- **`docs/STOREFRONT_DATA_CONTRACT.md`** — ✅ THE doc for anything touching a brand website (app ↔
  platform-api ↔ template data flow, exact API shapes, sync, the custom-site cutover). Read before
  editing storefronts, the catalogue, or `platform-api/app/api/public/**`.
- `docs/STOREFRONT_ENGINE.md` — how sites are generated (templates, forge, provisioning) ⚠️ refreshing
- `docs/ARCHITECTURE.md` — the 4 deployable units · `docs/DATABASE_PLAN.md` — schema (both ⚠️ refreshing)
- `docs/PAGES.md` · `docs/API.md` · `docs/REMAINING_FEATURES.md` · `docs/PRODUCTION_CHECKLIST.md` · `docs/DEV_BUILD.md`
- Specs (designed at template level): `docs/FEATURED_PRODUCTS.md`, `docs/COLLECTIONS_LOOKBOOK.md`

## The four deployable units (one shared Supabase Postgres)
1. **Mobile app** — this repo. `src/app/**+api.ts` server routes hold the authed creator logic. **The backend runs on Railway** (`backend-production-d7eb.up.railway.app`, persistent Node via `expo serve`) — NOT EAS Hosting (Cloudflare Workers broke postgres-js for authed routes; do not move it back). Deploy with the Railway GraphQL API + an explicit `commitSha` (no auto-deploy webhook yet). The iOS build's `EXPO_PUBLIC_API_URL` points here. See the `production-shipping` memory.
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
- **Dev build only (Expo Go retired as of build #12)**: `expo-notifications` (push, `PUSH_ENABLED=true`) + `expo-apple-authentication` (native Sign in with Apple, `src/lib/oauth.ts`) are now installed, so the project requires an EAS dev/standalone build — Expo Go can't load it. Still NOT installed (server sides done, seams off): IAP (`react-native-iap`, `IAP_ENABLED`), critique screenshots (`react-native-view-shot`). See `docs/DEV_BUILD.md`.
- **Expo Go stale bundle**: only `xcrun simctl terminate booted host.exp.Exponent` + relaunch forces a fresh rebundle.
- Nano Banana can't emit alpha → magenta chroma-key (`src/lib/transparency.ts`).
- `AUTO_FIRST_DROP=1` enables server-side first-drop generation (real spend) — uses `INTERNAL_API_KEY` to call the now-authed designer routes.

## Status (2026-06-15)
**LIVE on TestFlight**; backend on **Railway** (was EAS Hosting — Workers couldn't keep postgres-js
alive). **Build #12 building/submitting** with **native Sign in with Apple** (`expo-apple-authentication`
→ `signInWithIdToken`, no client secret) + **push** (`expo-notifications`, `PUSH_ENABLED=true`). The
Apple App ID now carries all 3 capabilities (IAP, Push, Apple) and the old provisioning profile was
invalidated → EAS regenerates clean (clears the cache that blocked builds #7–9). **Railway GitHub
auto-deploy is LIVE** (push to `main` → auto-deploy; the GitHub App had lost repo access — re-granted).
**Supabase auth** prod-ready (Site URL + redirects fixed, Apple provider enabled native-only,
**Facebook hidden for v1** — button removed + provider off). **Legal live**: Privacy + Terms at
`nanocrew-api.vercel.app/privacy` + `/terms`, linked in Account. **Security pass done** (no criticals;
shipped SSRF guard `src/lib/safe-fetch.ts`, merge IDOR fix, constant-time internal-key, opt-in
Printful-webhook token). Remaining is mostly Joe's config — see the **task list** +
`docs/PRODUCTION_CHECKLIST.md`. Top open: **Stripe go-live** (deferred to last), **Railway billing**
(trial expiring → backend offline), **Apple IAP** (next build; react-native-iap v15 StoreKit-2 vs the
server's legacy verifyReceipt — pick a path), and provisioning end-to-end verify (needs one Pro test
brand). See the `production-shipping` memory.

## Run
`npm run ios` · `npm run android` · `npm run web`
