# Working with the AI agent on Nano Crew — a developer's guide

Welcome. This guide explains how this project keeps its knowledge, and how to get great work out of
the AI agent (Claude) you'll be pairing with. Read it once; it'll save you a lot of archaeology.

> This file's prose is **generated** by the `/instructions` skill from the source docs
> (`NEVER_VIOLATE`, `CODE_STANDARDS`, the skills…). So if you spot something wrong here, fix it in the
> **source doc** it came from, then run `/instructions` to re-render this guide — that keeps them in sync.
>
> **How to use a skill:** type its slash-command to the agent in your session — e.g.
> `/architect add a returns dashboard`. (Memory + review are automatic, not commands — see below.)
>
> **Drift note (2026-08-20):** the doc audit patched this guide in place (five units; the CLAUDE.md /
> AGENTS.md split). A full `/instructions` regeneration is due.

## What this system is, and why

**Nano Crew is AI-native creator commerce** (Expo / React Native, iOS + Android): a creator talks to
**Eve** — a voice or typed AI brand consultant — and Nano Crew auto-generates a Printful-backed shop
*and* a per-brand storefront website, which they then design, sell, and edit by chatting. Its whole
job is **generating brand websites from templates**, so the architecture *is* the product. If that
architecture only lives in people's heads, brand sites drift, features ship inconsistently, and every
fix becomes archaeology. So we made the knowledge first-class:

- **We document as we build, not after.** Every code change updates the docs it affects, in the same
  change. A PR with stale docs is unfinished.
- **We reuse before we build.** Most things already exist. The fastest way to annoy the team (and the
  agent's instructions explicitly call this out) is to rebuild something that's already there.

The agent loads this knowledge on every task, so it starts each session already knowing the
architecture, the rules, and where everything lives.

## The map & the read-order

Two always-loaded files sit at the repo root:
- **`AGENTS.md`** — the durable core (what this is, the five deployable units, conventions, the
  documentation-discipline rule, the "where things live" table). Tool-agnostic.
- **`CLAUDE.md`** — the rules that stay in working memory: the read-order, the doc-drift and parity
  rules, UI preferences, the working loop, and the skills.

Everything else lives in **`docs/`**, split into two layers:
- **`docs/context/`** — the *working layer*: how to build here + the rules (this folder).
- **`docs/<division>/`** — the *domain layer*: how the product actually works (architecture,
  storefront, studio, accounts, app, ops, roadmap).

The canonical **read-order** (the agent follows it; you should too) is in
[`docs/context/README.md`](README.md): AGENTS → **PROJECT_OVERVIEW** (what it is + scope) →
NEVER_VIOLATE → CODE_STANDARDS → TECH_STACK → your task's division doc → the UI docs (if touching UI)
→ REMAINING_FEATURES.

**Where to put new knowledge:** a hard rule → `NEVER_VIOLATE.md`; a coding convention →
`CODE_STANDARDS.md`; a token/component → the `UI_*` docs; product behavior → the division doc; a
scope change → `PROJECT_OVERVIEW.md` / `REMAINING_FEATURES.md`. The agent does this **automatically as
it works** — the doc for the space being changed is updated in the same commit.

## Memory & review are automatic (no commands)

The two things you'd expect to "run" happen on their own:
- **Auto-memory** — the agent keeps the relevant doc current *in the same change*. You don't ask it to remember.
- **Auto-review** — before each commit it self-runs `tsc` + lint + the sync checks (schema-copy,
  palette ×3, RLS on new migrations); `expo export` before a push.
- **Commit often, no gate** — it commits at each logical milestone automatically; you don't review first.

See the "working loop" in [`CODE_STANDARDS.md`](CODE_STANDARDS.md).

## The skills (occasional, optional)

A few slash-commands in `.claude/commands/` for low-frequency moments — type them to the agent:

| Skill | Use it… |
|---|---|
| **/architect** | *Before* a big or ambiguous feature — the agent plans against the rules and finds what to reuse before coding. (Skip it for small changes.) |
| **/recover** | After a long or compacted session, when the agent's context is thin — it reloads the read-order and restates where you are. |
| **/imprint** | After a dependency bump or a schema migration — re-syncs the *agent* docs from the code. |
| **/instructions** | To regenerate *this* guide after the system changes. |

## The golden rules (plain language)

The full, enforced list is [`NEVER_VIOLATE.md`](NEVER_VIOLATE.md). In short — these silently break
things if ignored:

- **The database schema is written twice** (`src/db/schema.ts` and `platform-api/db/schema.ts`). Change
  both, every migration. New tables must turn on Row-Level Security.
- **Every creator only sees their own data** — per-creator access goes through one tenancy guard
  (`src/lib/tenant.ts`). Validating a *container* but trusting a client-supplied child id is the
  cross-tenant (IDOR) bug class; it leaks one brand's data to another.
- **In an authed server route, never `fetch()` before the first database query.** On the persistent
  Cloud Run host this kills the DB connection — a footgun unique to our hosting.
- **Storefront templates hold no secrets and no payment code** — checkout proxies to the central API.
- **Brand identity flows through one function** (`buildBrandPatch`). Copy is data — never hardcode a
  headline. Don't hand-edit one surface.
- **The app's color palette lives in three files** (`src/constants/theme.ts`, `src/lib/studio-palette.ts`,
  `src/components/nc-screen.tsx` — see [`UI_TOKENS.md`](UI_TOKENS.md)) — keep them in lockstep.
- **Before each commit:** `tsc` + lint must be green (`expo export` before a push). The agent self-checks this automatically.
- **The forge worker on the droplet is a manual copy** — editing it in the repo doesn't deploy it.

## How to collaborate well with the agent

- **Let it audit first.** Ask "does this exist already?" before "build me X." It's faster and avoids
  duplicate systems.
- **Point it at the task, not the file.** "We're touching the storefront catalogue" lets it open the
  right division doc and load the right rules.
- **Let it commit often.** It commits at each logical milestone automatically (self-checking first) —
  you don't review before a commit. Deploys, pushes to shared branches, and anything outward-facing it
  still confirms with you.
- **Docs ride the same change automatically.** If behavior changes, the matching doc update is in the commit.
- **Trust the self-check.** If the agent says a change is blocked (tsc/lint/sync failing), it's a real
  problem — it fixes it rather than committing around it.

## 5-minute quickstart

1. **Clone** and read, in order: `AGENTS.md` → `docs/context/PROJECT_OVERVIEW.md` (what it is + scope)
   → `docs/context/NEVER_VIOLATE.md` → `docs/context/CODE_STANDARDS.md`. Skim `docs/architecture/TECH_STACK.md`.
2. **Pick a task.** For something big, `/architect` it first; for small changes, just describe it.
3. **Build** — reuse the UI primitives + tokens (`docs/context/UI_REGISTRY.md`), follow the standards.
4. **It closes itself** — the agent self-checks (`tsc` + lint), updates the affected doc, and commits.

That's the loop. Welcome aboard.
