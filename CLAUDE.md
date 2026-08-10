@AGENTS.md

# Nano Crew — context map

AI-native creator commerce (Expo / React Native, iOS + Android): a creator talks to **Eve** →
Nano Crew auto-generates a Printful-backed shop **and** a per-brand storefront, then they design,
sell, and edit the site by chatting. This file is the **orchestrator** — it tells you what to read,
in what order, and which doc owns each task. The durable core (units, conventions, doc-discipline)
is in [`AGENTS.md`](AGENTS.md); the working rules live in [`docs/context/`](docs/context/README.md).

> **New here (a human)? →** [`docs/context/CONTEXT_GUIDE.md`](docs/context/CONTEXT_GUIDE.md) — the
> plain-English guide to this system and how to work with the AI agent.

## Read order (load these first, every task)
1. [`AGENTS.md`](AGENTS.md) — what this is, the four units, documentation discipline.
2. [`docs/context/PROJECT_OVERVIEW.md`](docs/context/PROJECT_OVERVIEW.md) — the product, the user flow, and what's in/out of scope.
3. [`docs/context/NEVER_VIOLATE.md`](docs/context/NEVER_VIOLATE.md) — the hard rules. **Before any change.**
4. [`docs/context/CODE_STANDARDS.md`](docs/context/CODE_STANDARDS.md) — how we write code here.
5. [`docs/architecture/TECH_STACK.md`](docs/architecture/TECH_STACK.md) — the technology inventory.
6. the **division doc** for your task (table below).
7. [`docs/context/UI_RULES.md`](docs/context/UI_RULES.md) (+ TOKENS, REGISTRY) — when touching UI.
8. [`docs/roadmap/REMAINING_FEATURES.md`](docs/roadmap/REMAINING_FEATURES.md) — in flight vs. scope.

## Where things live (open the entry doc, don't guess)
| When you're touching… | Read first |
|---|---|
| The rules / how to work | [`docs/context/`](docs/context/README.md) |
| A brand website · catalogue · public API | [`docs/storefront/STOREFRONT_DATA_CONTRACT.md`](docs/storefront/STOREFRONT_DATA_CONTRACT.md) |
| App UI — buttons, inputs, tokens, a new screen | [`docs/context/UI_RULES.md`](docs/context/UI_RULES.md) (+ UI_TOKENS, UI_REGISTRY) |
| Eve build → forge → publish | [`docs/studio/BUILD_FLOW.md`](docs/studio/BUILD_FLOW.md) · [`FORGE_AI.md`](docs/studio/FORGE_AI.md) |
| Eve's avatar look | [`docs/studio/VENUS_AVATAR.md`](docs/studio/VENUS_AVATAR.md) + the Eve Lab (below) |
| Identity · orders · money · credits | [`docs/accounts/`](docs/accounts/README.md) |
| Creating a template | [`docs/storefront/TEMPLATE_AUTHORING.md`](docs/storefront/TEMPLATE_AUTHORING.md) |
| Schema · endpoints | [`docs/architecture/DATABASE_PLAN.md`](docs/architecture/DATABASE_PLAN.md) · [`API.md`](docs/architecture/API.md) |
| What's shipped vs open | [`docs/roadmap/REMAINING_FEATURES.md`](docs/roadmap/REMAINING_FEATURES.md) |

Full doc map: [`docs/README.md`](docs/README.md).

## Automatic working loop (no command needed)
Memory and review are **behaviors, not commands** — see [`docs/context/CODE_STANDARDS.md`](docs/context/CODE_STANDARDS.md):
- **Auto-memory** — the doc for the view/space being worked on is updated in the same change.
- **Auto-review** — `tsc` + lint + the sync checks (schema/palette/RLS) run before each commit; `expo export` before a push.
- **Commit often, no gate** — commit at each logical milestone automatically; Joe doesn't review first.

## Skills (`.claude/commands/`) — occasional, optional
- **/architect** — plan a big/ambiguous feature against the context docs before coding.
- **/recover** — rebuild context after a long / compacted session.
- **/imprint** — refresh the context docs from the current code.
- **/instructions** — regenerate the human onboarding guide ([`CONTEXT_GUIDE.md`](docs/context/CONTEXT_GUIDE.md)).

## Per-unit rules
- **App backend** (`src/app/**+api.ts`, Cloud Run): no `fetch()` before the first DB query.
- **platform-api/** — its own [`CLAUDE.md`](platform-api/CLAUDE.md) (Next + Stripe; schema-copy sync).
- **forge-worker/** — its own [`CLAUDE.md`](forge-worker/CLAUDE.md) (re-scp the worker). NB:
  `forge-worker/forge-CLAUDE.md` conditions the storefront-building **robot**, not the dev agent.

## Editing Eve's APPEARANCE? → the Eve Lab
Source of truth: [`docs/studio/VENUS_AVATAR.md`](docs/studio/VENUS_AVATAR.md). Open the Eve Lab from
**Account → Developer → "Eve Lab (test)"** (gated to josephsardella@gmail.com) to render the live
avatar (`src/components/backgrounds/venus-orb-scene.tsx`); nearly all of her look lives in that one
scene file. The `DEV_LIPSYNC_TEST` flag in that scene must be `false` before any build/PR.

## Status & scope
- Current status + open work (the progress-tracker): [`docs/roadmap/REMAINING_FEATURES.md`](docs/roadmap/REMAINING_FEATURES.md).
- In-flight / deferred / parked buckets: [`docs/context/PROJECT_OVERVIEW.md`](docs/context/PROJECT_OVERVIEW.md).

## Run
`npm run ios` · `npm run android` · `npm run web`
