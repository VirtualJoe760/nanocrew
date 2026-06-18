@AGENTS.md

# Nanocrew

AI-native creator commerce (Expo / React Native, iOS + Android). A creator talks to **Venus**
(voice or typed AI) to define a clothing brand; Nanocrew auto-generates a Printful-backed shop
**and** a per-brand storefront website, then lets them design products, post, sell video/on-model
ads, and edit their site by chatting. Built on the proven `stephen-lawyer` create→design→Printful
loop (sibling dir).

## How to work here (read this before changing anything)
- **Reuse before you build. Audit first.** Most things already exist — one Supabase identity *is*
  the `creators` table (id = supabase uid, email unique); orders link to a person by
  `customerEmail`; blog posts write straight to the DB; domains, Stripe Connect payouts, the design
  generator, and go-live phases are all built. Before adding a table, model, endpoint, or "system,"
  search the code **and** the relevant `docs/` division and confirm it isn't already there. This is
  Joe's repeated, explicit feedback: **stop rebuilding what exists.**
- **The build flow is settled — make both ends brilliant, don't re-architect it.** Venus (AI #1)
  authors a build prompt → a conditioned forge Claude (AI #2) builds/edits the site. The lifecycle
  is **build (instant + presentable) → refine (design generator swaps in real assets) → publish
  (link a domain, go live, store+fulfilment active, mirrored in the app)**. See `docs/studio/`.
- **Direct vs forge.** Precise, deterministic actions go through **direct creator APIs** (like blog
  posts: a DB write — instant, reliable), NOT the forge. Only open-ended creative work (build/edit a
  whole site) goes to the forge robot. When adding a capability, prefer the direct path.
- **Don't rush; don't over-engineer.** Confirm the plan, reuse existing pieces, keep changes scoped.
  Quality + correctness over speed. When in doubt, audit and show the map before writing code.

## Read the docs first — and update them as you build
Documentation is a first-class division in **`docs/`**. Start at **`docs/README.md`** (the map) and
**`AGENTS.md` "Documentation discipline"**: **every code change updates the docs it affects, in the
same change**, and storefront-facing features are wired at the *template* level so every generated
brand site ships them.
The division is organized into subdirectories — open the one you need:
- **`docs/storefront/STOREFRONT_DATA_CONTRACT.md`** — THE doc for anything touching a brand website
  (app ↔ platform-api ↔ template data flow, exact API shapes, sync, custom-site cutover). Read
  before editing storefronts, the catalogue, or `platform-api/app/api/public/**`.
- **`docs/storefront/BUILD_QUALITY.md`** + **`docs/studio/FORGE_AI.md`** — the **CURRENT FOCUS**:
  why generated sites still look like bare templates, and how our AI talks to the forge robot (the
  mail-merge brief, the unconditioned robot, the swallowed failures, and the fix). Read these before
  touching provisioning, the brief, or the forge.
- `architecture/` — ARCHITECTURE · DATABASE_PLAN · API
- `storefront/` — STOREFRONT_ENGINE · STOREFRONT_DATA_CONTRACT · BUILD_QUALITY · FEATURED_PRODUCTS · COLLECTIONS_LOOKBOOK
- `studio/` — BUILD_FLOW · FORGE_AI · DESIGN_GENERATOR (the Venus→forge build, refine, publish arc)
- `accounts/` — AUTH_IDENTITY · ORDERS · BILLING_CREDITS (one Supabase identity; orders by email; plans/credits/Connect)
- `app/` PAGES · `ops/` PRODUCTION_CHECKLIST + DEV_BUILD · `roadmap/`

## The four deployable units (one shared Supabase Postgres)
1. **Mobile app** — this repo. `src/app/**+api.ts` server routes hold the authed creator logic. **The backend runs on Railway** (`backend-production-d7eb.up.railway.app`, persistent Node via `expo serve`) — NOT EAS Hosting (Cloudflare Workers broke postgres-js for authed routes; do not move it back). Deploy with the Railway GraphQL API + an explicit `commitSha` (no auto-deploy webhook yet). The iOS build's `EXPO_PUBLIC_API_URL` points here. See the `production-shipping` memory.
2. **platform-api** — `platform-api/` (Next.js, Vercel `nanocrew-api.vercel.app`). Public storefront API + webhooks. **`platform-api/db/schema.ts` is a COPY of `src/db/schema.ts` — re-sync it on EVERY migration.**
3. **nanocrew-templates** (sibling repo) — 5 Next.js storefront templates (minimal · bold · elegant · extravagant · **street** — the last a bold full-bleed streetwear/editorial design promoted from the Stephen Lawyer site, with the full copy/font/color mini-CMS); `brand.json` token contract.
4. **forge** — DO droplet (`ssh nanocrew-forge`) running headless Claude; provisions + revises brand sites on working branches.

## Stack & conventions
- Expo SDK 54, expo-router, RN 0.81, React 19, TS. npm (not pnpm).
- Supabase Auth + Postgres via Drizzle. `npm run db:generate` / `db:migrate`, then sync the platform-api schema copy.
- **Authed client calls use `apiFetch()`** (`src/lib/api.ts`) — attaches the Supabase token. The designer + creator endpoints are auth + per-creator scoped (`src/lib/tenant.ts`); paid AI endpoints are credit-gated (`src/lib/credits.ts`) and rate-limited (`src/lib/rate-limit.ts`).
- **Brand = cool monochrome (paper / near-pure black) + platinum silver** (the Nano Crew asset sheet — "depth, dimension, sophistication"; NO gold), clean sans, serif only for the NC mark. Palette lives in THREE places — keep aligned: `src/constants/theme.ts` (`Colors`), `src/lib/studio-palette.ts` (Studio modals), `src/app/studio.tsx` `makePalette` (Studio screen). Individual brand storefronts keep their OWN colors — only the app chrome is monochrome. The **NC app icon + marks** were regenerated from `assets/brand/nano-crew-logo.png` into `assets/images/*` (icon, favicon, splash, Android adaptive) + `assets/brand/*` (`nc-mark.png` transparent, `play-store-icon-512.png`); the paywall header + nanocrew.app nav/favicon use the NC mark.
- **Site edits are branch-based** (`revise.ts`): never edit a brand's `main` directly — change → `revision/<id>` branch → Vercel preview → creator approves → merge.
- **Commit often + push** (Joe's preference): commit at each logical milestone; verify `tsc` + `npx expo export` before pushing. End commit messages with the Co-Authored-By trailer.

## Tabs (`src/components/app-tabs.tsx`, NativeTabs + gold tint)
- `index.tsx` — **Nanocrew** feed (video-first, like/share/try-on)
- `market.tsx` — **Market** (discovery + in-app brand store)
- `studio.tsx` — **Studio** (Venus interview + brand dashboard → per-brand Console)
- `design.tsx` — **Design** (AI designer canvas → Printful publish)
- `account.tsx` — **Account** (auth, billing portal, account deletion, platform admin)

## Constraints / gotchas
- **Dev build only (Expo Go retired as of build #12)**: `expo-notifications` (push, `PUSH_ENABLED=true`), `expo-apple-authentication` (native Sign in with Apple, `src/lib/oauth.ts`), and `react-native-iap` (v15, **Apple IAP / StoreKit 2** — client `src/lib/iap.ios.ts`, dormant until `APPLE_IAP_*` env) are installed, so the project requires an EAS dev/standalone build — Expo Go can't load it. Still NOT installed (server side done, seam off): critique screenshots (`react-native-view-shot`). See `docs/ops/DEV_BUILD.md`.
- **Expo Go stale bundle**: only `xcrun simctl terminate booted host.exp.Exponent` + relaunch forces a fresh rebundle.
- Nano Banana can't emit alpha → magenta chroma-key (`src/lib/transparency.ts`).
- `AUTO_FIRST_DROP=1` enables server-side first-drop generation (real spend) — uses `INTERNAL_API_KEY` to call the now-authed designer routes.

## Status (2026-06-17)
The product is now **Nano Crew** (spaced in prose; the `nanocrew` slug/URLs/repo names are unchanged).
The app lands on **Studio** — the **social feed is hidden for v1** (code preserved at the `/feed`
route, no tab; returns in v2), so the tab bar is **Studio · Design · Market · Account**. **Close to
production-ready.**

Shipped this session: the **mini-CMS** (Studio → ✦ Customize edits site copy/colors/fonts live with
no rebuild — `stores.site_config`, migration 0018, `POST /api/creator/site-config` → public
`GET /api/public/stores/:slug/site-config`, read by all 4 templates), **✦ Enhance** (AI rewrite per
text box, `/api/creator/enhance-copy`), a full **SEO layer** in all 4 templates (canonical URLs +
Organization/Product/BlogPosting JSON-LD, OpenGraph/Twitter, sitemap + robots), a header **cart icon**,
the **Account screen rebrand**, and the **Design-tab brand→collection picker**.

Also shipped this session: **app-only Publish** (`POST /api/creator/stores/:slug/publish` — sell in
the in-app Market + on `nanocrew.app/b/<slug>` with just an active plan + a published product; a
custom domain/dedicated website is now a SEPARATE Pro upgrade, not a prerequisite), **per-brand web
storefronts + the Nano Crew company store** (`nanocrew.app/b/<slug>` + `/store`, in `./nanocrew-site`,
single-brand cart, shared POS), **comp/internal accounts** (`src/lib/comp.ts`, `COMP_EMAILS` →
top-tier free entitlements + `debitCredits` no-op), the **Supabase RLS lockdown** (RLS enabled
deny-all on all public tables — new migrations must `ENABLE ROW LEVEL SECURITY`), a **mini-CMS hex
color picker** (HSB gradient sliders in `src/components/site-editor.tsx`), **durable real-time build
status** (Studio Edit-site tab derives "building" from store status + the `store_revisions` job row,
not a local flag), the **Stephen Lawyer migration deployed** (app-driven lookbook, on-model imagery
for all 21 products), the **new NC icon/marks**, and **finalized credit pricing** (flat $0.01/cr
floor, no pack discount, every charge ≥2× real cost — `model_shots` 25, Seedance 260).

**LIVE on TestFlight**; backend on **Railway** (was EAS Hosting — Workers couldn't keep postgres-js
alive). **Build #16** (2026-06-16) ships **native Sign in with Apple** (`expo-apple-authentication`
→ `signInWithIdToken`, no client secret), **push** (`expo-notifications`, `PUSH_ENABLED=true`), and
**Apple IAP — StoreKit 2** (`react-native-iap` v15 in the binary; server verifies via the App Store
Server API, `src/lib/app-store.ts` + `iap-verify`, plans + credit packs, dormant until `APPLE_IAP_*`
env + App Store Connect products). The Apple App ID carries all 3 capabilities (IAP, Push, Apple).
**Railway GitHub auto-deploy is LIVE** (push to `main` → auto-deploy). **Supabase auth** prod-ready
(Site URL + redirects fixed, Apple provider native-only, **Facebook hidden for v1**). **Legal live**:
Privacy + Terms at `nanocrew-api.vercel.app/privacy` + `/terms`. **Security pass done** (no criticals;
SSRF guard `src/lib/safe-fetch.ts`, merge IDOR fix, constant-time internal-key, opt-in Printful-webhook
token, RLS lockdown). **Android build + Google Play** in progress (`docs/ops/PLAY_STORE.md`). Remaining
is mostly Joe's config — see `docs/ops/PRODUCTION_CHECKLIST.md`. Top open: **🔴 platform-api commerce
is still on a TEST Stripe key** (`cs_test_` sessions — real purchases won't charge until its
`STRIPE_SECRET_KEY` is switched to live), **Stripe Connect go-live**, App Store Connect IAP product
config, and provisioning end-to-end verify (needs one Pro test brand). See the `production-shipping`
memory.

**Build quality — mostly shipped.** The build-quality epic's first two fixes are in: Venus now
*authors* the build brief (`authorBrandBrief`, gemini-2.5-pro — not a mail-merge) and a **Master
CLAUDE.md** (`forge-worker/forge-CLAUDE.md` → `/home/forge/.claude/CLAUDE.md`) conditions the forge
robot. What remains: give the robot **eyes + a self-critique loop** on the provision path and a real
quality gate (no more `|| true` silent-fail flipping the store to `ready`). See
`docs/storefront/BUILD_QUALITY.md` + `docs/studio/FORGE_AI.md`.

## Run
`npm run ios` · `npm run android` · `npm run web`
