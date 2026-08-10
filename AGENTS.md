# Working in Nano Crew

The durable core for any agent (Claude Code or otherwise) working in this repo. Tool-specific
orchestration (read-order, skills) is in [`CLAUDE.md`](CLAUDE.md); the hard rules are in
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

## The four deployable units (one shared Supabase Postgres)
1. **Mobile app** — this repo. `src/app/**+api.ts` server routes hold authed creator logic; **the
   backend runs on Cloud Run** (persistent Node via `expo serve`) — NOT EAS Hosting.
2. **platform-api** — `platform-api/` (Next.js, Vercel). Public storefront API + webhooks.
   `platform-api/db/schema.ts` is a **copy** of `src/db/schema.ts` — re-sync every migration.
3. **nanocrew-templates** (sibling repo) — 5 Next.js storefront templates; `brand.json` token contract.
4. **forge** — DO droplet (`ssh nanocrew-forge`) running headless Claude; provisions + revises brand
   sites on working branches via `forge-worker/`.

Details + versions: [`docs/architecture/TECH_STACK.md`](docs/architecture/TECH_STACK.md) and
[`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md).

## Conventions (full list: `docs/context/CODE_STANDARDS.md`)
- Expo SDK 54, expo-router, RN 0.81, React 19, TypeScript strict. **npm** (not pnpm).
- Supabase Auth + Postgres via Drizzle. Authed client calls use **`apiFetch()`** (attaches the token);
  creator endpoints are per-creator scoped (`src/lib/tenant.ts`), paid AI is credit-gated + rate-limited.
- App chrome = **cool monochrome + platinum silver** (no gold); brand storefronts keep their own colors.
- Site edits are **branch-based** (`revision/<id>`), never on a brand's `main`.
- **Commit often, automatically** (Joe doesn't review first); self-run `tsc` + lint before a commit,
  `npx expo export` before a push; end commits with the
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer. (The "working loop" in CODE_STANDARDS.)

## Tabs (`src/components/app-tabs.tsx`)
**Studio · Design · Market · Account** (the social feed is hidden for v1, preserved at `/feed`).
Per-screen detail: [`docs/app/PAGES.md`](docs/app/PAGES.md).

## Documentation discipline (read before writing any code)
This app's whole job is **generating brand websites from templates**, so the architecture is the
product. We document as we build — not after. **The rule: every code change updates the docs it
affects, in the same change.**
- Touch the schema → [`DATABASE_PLAN.md`](docs/architecture/DATABASE_PLAN.md) **and** sync `platform-api/db/schema.ts`.
- Touch an API route/shape → [`API.md`](docs/architecture/API.md) (+ [`STOREFRONT_DATA_CONTRACT.md`](docs/storefront/STOREFRONT_DATA_CONTRACT.md) if a storefront reads it).
- Touch storefront data/provisioning/sync → [`STOREFRONT_ENGINE.md`](docs/storefront/STOREFRONT_ENGINE.md) + the data contract.
- Add a reusable component → [`docs/context/UI_REGISTRY.md`](docs/context/UI_REGISTRY.md).
- Build a storefront-facing feature → wire it at the **template level** so every generated site gets it.
- Finish a feature → move it in [`REMAINING_FEATURES.md`](docs/roadmap/REMAINING_FEATURES.md).

The specs are the source of truth for *how things should work*; the code for *how they currently
work*. When they disagree, that's a bug — surface it. **A PR that ships code with stale docs is
incomplete.** This is automatic — the doc update rides the same change (the auto-review checks the
high-signal mappings before each commit). See [`docs/context/CODE_STANDARDS.md`](docs/context/CODE_STANDARDS.md) "working loop".
