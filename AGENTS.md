# Working in Nano Crew

The durable core for any agent (Claude Code or otherwise) working in this repo: what this is, where
everything lives, and the conventions. The handful of rules that must stay in working memory — the
documentation-drift policy, the parity rules, the UI preferences — are in
[`CLAUDE.md`](CLAUDE.md). The hard rules are in
[`docs/context/NEVER_VIOLATE.md`](docs/context/NEVER_VIOLATE.md).

## What this is
AI-native creator commerce (Expo / React Native, iOS + Android). A creator talks to **Eve** (voice
or typed AI) to define a clothing brand; Nano Crew auto-generates a Printful-backed shop **and** a
per-brand storefront website, then lets them design products, sell, and edit their site by chatting.
Built on the proven `stephen-lawyer` create → design → Printful loop. Full overview:
[`docs/context/PROJECT_OVERVIEW.md`](docs/context/PROJECT_OVERVIEW.md).

## Expo has changed — read the versioned docs
This repo is on **Expo SDK 54**. Read the exact versioned docs at
`https://docs.expo.dev/versions/v54.0.0/` before writing code against the SDK — and verify any
fast-moving API (RN, AI model IDs) against current docs rather than memory
([`CODE_STANDARDS.md`](docs/context/CODE_STANDARDS.md)).

## How to work here
- **Reuse before you build. Audit first.** Most things already exist (one Supabase identity = the
  `creators` table; orders-by-email; the design generator; go-live phases; the UI primitives). Search
  the code **and** the relevant `docs/` division before adding a table, model, endpoint, "system," or
  component. Joe's strongest, most-repeated correction — **stop rebuilding what exists.**
- **The build flow is settled — make both ends brilliant, don't re-architect it.** Eve (AI #1)
  authors a build brief → a conditioned forge robot (AI #2) builds/edits the site. Lifecycle:
  **build** (instant + presentable) → **refine** (the design generator swaps in real assets) →
  **publish** (list in-app + on the web; a domain is a separate Pro upgrade). See `docs/studio/`.
- **Direct vs forge.** Deterministic actions go through **direct creator APIs** (a DB write — instant,
  reliable), NOT the forge. Only open-ended creative work (build/edit a whole site) goes to the robot.
- **Don't rush; don't over-engineer.** Confirm the plan, reuse existing pieces, keep changes scoped.
  Quality + correctness over speed. When in doubt, audit and show the map before writing code.
- **Prove it, don't assume it.** A fix is done when the output changed, not when the code changed —
  read the log line, the row, the diff. Where the system isn't legible, add one line so it is.

## Where things live
Open the entry doc; don't guess.

| When you're touching… | Read first |
|---|---|
| The rules / how to work | [`docs/context/`](docs/context/README.md) |
| A brand website · catalogue · public API | [`docs/storefront/STOREFRONT_DATA_CONTRACT.md`](docs/storefront/STOREFRONT_DATA_CONTRACT.md) |
| App UI — buttons, inputs, tokens, a new screen | [`docs/context/UI_RULES.md`](docs/context/UI_RULES.md) (+ UI_TOKENS, UI_REGISTRY) |
| **Designing — either surface** | [`docs/studio/DESIGN_SURFACES.md`](docs/studio/DESIGN_SURFACES.md) — **the tab and Eve move together** |
| Eve build → forge → publish | [`docs/studio/BUILD_FLOW.md`](docs/studio/BUILD_FLOW.md) · [`FORGE_AI.md`](docs/studio/FORGE_AI.md) |
| How Eve TALKS (persona, questions) | [`docs/studio/EVE_VOICE.md`](docs/studio/EVE_VOICE.md) — change one persona, change all three |
| Her live voice session (sockets, captions) | [`docs/studio/GEMINI_LIVE.md`](docs/studio/GEMINI_LIVE.md) · her character files: [`src/eve/README.md`](src/eve/README.md) |
| Eve's avatar look | [`docs/studio/VENUS_AVATAR.md`](docs/studio/VENUS_AVATAR.md) + the Eve Lab (below) |
| Identity · orders · money · credits | [`docs/accounts/`](docs/accounts/README.md) |
| Emails (any of them) | [`docs/accounts/EMAIL_PIPELINE.md`](docs/accounts/EMAIL_PIPELINE.md) — adding one updates the catalogue |
| The **account page** (app *or* web) | [`docs/accounts/ACCOUNT_SURFACE.md`](docs/accounts/ACCOUNT_SURFACE.md) — **change all three: app · site · API** |
| Logo, icon, share card, email art | [`assets/brand/README.md`](assets/brand/README.md) — one generator owns every raster |
| The marketing site / nanocrew.app | [`nanocrew-site/CLAUDE.md`](nanocrew-site/CLAUDE.md) |
| Creating a template | [`docs/storefront/TEMPLATE_AUTHORING.md`](docs/storefront/TEMPLATE_AUTHORING.md) |
| Schema · endpoints | [`docs/architecture/DATABASE_PLAN.md`](docs/architecture/DATABASE_PLAN.md) · [`API.md`](docs/architecture/API.md) |
| What's shipped vs open | [`docs/roadmap/REMAINING_FEATURES.md`](docs/roadmap/REMAINING_FEATURES.md) |

Full doc map: [`docs/README.md`](docs/README.md). Status + open work:
[`REMAINING_FEATURES.md`](docs/roadmap/REMAINING_FEATURES.md); in-flight / deferred / parked buckets:
[`PROJECT_OVERVIEW.md`](docs/context/PROJECT_OVERVIEW.md).

## The five deployable units (one shared Supabase Postgres)
1. **Mobile app** — this repo. `src/app/**+api.ts` server routes hold authed creator logic; **the
   backend runs on Cloud Run** (persistent Node via `expo serve`) — NOT EAS Hosting. No `fetch()`
   before the first DB query.
2. **platform-api** — `platform-api/` (Next.js, Vercel). Public storefront API + webhooks, the
   mailer, and the App Store Connect key. `platform-api/db/schema.ts` is a **copy** of
   `src/db/schema.ts` — re-sync every migration. Its own [`CLAUDE.md`](platform-api/CLAUDE.md).
3. **nanocrew-site** — `nanocrew-site/` (Next.js, Vercel) at **nanocrew.app**. The public web
   surface: marketing, the HQ store, and the **signed-in account page**. Holds **no** database
   credential — it consumes the API over HTTP, anonymously for the catalogue and with a Supabase
   bearer via `lib/api.ts` (the web sibling of the app's `apiFetch()`). Its own
   [`CLAUDE.md`](nanocrew-site/CLAUDE.md).
4. **nanocrew-templates** (sibling repo) — 5 Next.js storefront templates; `brand.json` token contract.
5. **forge** — DO droplet (`ssh nanocrew-forge`) running headless Claude; provisions + revises brand
   sites on working branches via `forge-worker/`. Editing `forge-worker/worker.mjs` does **not** ship
   it — re-scp it. Its own [`CLAUDE.md`](forge-worker/CLAUDE.md); NB `forge-CLAUDE.md` beside it
   conditions the storefront-building **robot**, not the dev agent.

Details + versions: [`docs/architecture/TECH_STACK.md`](docs/architecture/TECH_STACK.md) and
[`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md).

## Conventions (full list: `docs/context/CODE_STANDARDS.md`)
- Expo SDK 54, expo-router, RN 0.81, React 19, TypeScript strict. **npm** (not pnpm).
- Supabase Auth + Postgres via Drizzle. Authed client calls use **`apiFetch()`** (attaches the token);
  creator endpoints are per-creator scoped (`src/lib/tenant.ts`), paid AI is credit-gated + rate-limited.
- Site edits are **branch-based** (`revision/<id>`), never on a brand's `main`.
- Commits end with the `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` trailer.
- The palette, the parity rules and the doc-drift policy live in [`CLAUDE.md`](CLAUDE.md).

## Tabs (`src/components/app-tabs.tsx`)
**Eve · Design · Market · Account** — the `studio` route is the Eve page (Studio merged into it; see
[`docs/studio/EVE_CONTROL.md`](docs/studio/EVE_CONTROL.md)). The social feed stays hidden for v1,
preserved at `/feed`. Per-screen detail: [`docs/app/PAGES.md`](docs/app/PAGES.md).

## Documentation discipline
This app's whole job is **generating brand websites from templates**, so the architecture is the
product. We document as we build — not after. The policy is in [`CLAUDE.md`](CLAUDE.md); this is the
mapping it refers to, and it is a **floor, not the whole duty**:

- Touch the schema → [`DATABASE_PLAN.md`](docs/architecture/DATABASE_PLAN.md) **and** sync `platform-api/db/schema.ts`.
- Touch an API route/shape → [`API.md`](docs/architecture/API.md) (+ [`STOREFRONT_DATA_CONTRACT.md`](docs/storefront/STOREFRONT_DATA_CONTRACT.md) if a storefront reads it).
- Touch storefront data/provisioning/sync → [`STOREFRONT_ENGINE.md`](docs/storefront/STOREFRONT_ENGINE.md) + the data contract.
- Touch either **design surface** → [`DESIGN_SURFACES.md`](docs/studio/DESIGN_SURFACES.md), and ship the capability on both.
- Touch her live session / captions / persona → [`GEMINI_LIVE.md`](docs/studio/GEMINI_LIVE.md) · [`EVE_PERSONALITY.md`](docs/studio/EVE_PERSONALITY.md).
- Add or change an **email** → [`EMAIL_PIPELINE.md`](docs/accounts/EMAIL_PIPELINE.md) catalogue.
- Add a reusable component or shared hook → [`UI_REGISTRY.md`](docs/context/UI_REGISTRY.md).
- Touch the **account page** → app + site + API together, then [`ACCOUNT_SURFACE.md`](docs/accounts/ACCOUNT_SURFACE.md).
- Touch a brand raster (icon, mark, share card) → regenerate via `scripts/gen-app-icon.mjs`; [`assets/brand/README.md`](assets/brand/README.md).
- Build a storefront-facing feature → wire it at the **template level** so every generated site gets it.
- Finish a feature → move it in [`REMAINING_FEATURES.md`](docs/roadmap/REMAINING_FEATURES.md).

## Editing Eve's APPEARANCE? → the Eve Lab
Source of truth: [`docs/studio/VENUS_AVATAR.md`](docs/studio/VENUS_AVATAR.md). Open the Eve Lab from
**Account → Developer → "Eve Lab (test)"** (gated to josephsardella@gmail.com) to render the live
avatar (`src/components/backgrounds/venus-orb-scene.tsx` plus its sibling `venus-*` modules —
plasma, geometry, shaders, points, textures); the same one avatar mounts persistently at the app
root via `src/components/eve/eve-background.tsx`. The Lab's test hooks are `__DEV__`-gated inside
the scene, so nothing needs resetting before a build/PR.

## Run
`npm run ios` · `npm run android` · `npm run web`
