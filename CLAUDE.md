@AGENTS.md

# Nano Crew — the rules that stay in memory

AI-native creator commerce: a creator talks to **Eve**, and Nano Crew generates a Printful-backed
shop **and** a per-brand storefront, which they then design, sell and edit by chatting.

This file is **deliberately short**. It holds only what must be true in working memory on every
task. The bones — the units, the directory of which doc owns what, the conventions — are in
[`AGENTS.md`](AGENTS.md), loaded above.

> **New here (a human)? →** [`docs/context/CONTEXT_GUIDE.md`](docs/context/CONTEXT_GUIDE.md).

## Before any task
1. [`AGENTS.md`](AGENTS.md) — what this is, the five units, the directory, documentation discipline.
2. [`docs/context/NEVER_VIOLATE.md`](docs/context/NEVER_VIOLATE.md) — the hard rules.
3. [`docs/context/CODE_STANDARDS.md`](docs/context/CODE_STANDARDS.md) — how we write code here.
4. The **division doc** for your task — the table in [`AGENTS.md`](AGENTS.md#where-things-live).

## 🔴 Documentation drift is a defect

**Every change updates the documentation it affects, in the same change.** Not at the end of the
day, not in a follow-up — the same commit. A change that ships with stale docs is incomplete, and a
doc that describes behaviour the code no longer has is worse than no doc at all: the next session
reads it and acts on it.

When you finish a piece of work, before you commit: **ask which docs your change just made wrong.**
The mapping table in [`AGENTS.md`](AGENTS.md#documentation-discipline) tells you which file owns
what — but the mapping is a floor, not the whole duty. If you changed how something behaves, find
the doc that describes that behaviour and fix it, whether or not it appears in the table.

The specs are the source of truth for *how things should work*; the code for *how they currently
work*. When they disagree that is a bug — say so out loud rather than quietly picking a side.

## 🔴 Parity rules — one product, several front doors

Both of these are the same rule: a creator meets the product through more than one door, and the
doors are not allowed to drift.

- **Design.** The **Design Center** (`src/app/design.tsx`) and **Eve's design pipeline**
  (`src/components/eve/eve-design.tsx`) are one product. A capability added to one is added to the
  other in the same change, built into the shared `src/components/designer/` seam first. The parity
  matrix — including what is deliberately *not* parity — is
  [`docs/studio/DESIGN_SURFACES.md`](docs/studio/DESIGN_SURFACES.md); update it in that same change.
- **Account.** The account page exists in the app (`src/app/account.tsx`), on the website
  (`nanocrew-site/app/account/`) and in the API. Change one → change all three, then update the
  matrix in [`docs/accounts/ACCOUNT_SURFACE.md`](docs/accounts/ACCOUNT_SURFACE.md).

Intentional exceptions are recorded in those matrices with a reason, never left implicit.

## UI preferences
- **Cool monochrome + platinum silver.** `#08080a` ground, `#cdd1d9` accent. **No gold, no warm
  neutrals.** Brand storefronts keep their own colours; the app chrome does not.
- **Eve blue `#7fd7e6` is hers.** In the app it appears only where Eve herself does. On outward
  surfaces — email, the social card — it is the brand accent, because the logo is her glyph.
- **Type is Jost**, self-hosted in both the app and the site. Email is the one place a font CDN is
  allowed (there is no bundler in an inbox).
- **Safe-area insets on every edge**, in mockups as well as code. Never draw under the Dynamic
  Island, and never let the tab bar clip a control — full-screen surfaces reserve it with
  `tabBarSpace()`.
- **Reuse the primitives.** Check [`docs/context/UI_REGISTRY.md`](docs/context/UI_REGISTRY.md)
  before building a component; add new reusable ones to it. Tokens and rules:
  [`UI_RULES.md`](docs/context/UI_RULES.md) · [`UI_TOKENS.md`](docs/context/UI_TOKENS.md).
- **Voice-first surfaces stay voice-first.** Eve asks and then opens a surface; she never lands the
  creator in a bare form. A typed path is a deliberate fallback, not the default.

## The working loop (behaviours, not commands)
- **Commit often, no gate.** Commit at each logical milestone; Joe doesn't review first.
- **Self-review before each commit:** `tsc` + lint + the sync checks (schema / palette / RLS).
  `npx expo export` before a push.
- **Update the docs in the same commit** — the rule above, applied.

## Skills (`.claude/commands/`) — occasional, optional
**/architect** plan a big feature first · **/recover** rebuild context after a compaction ·
**/imprint** refresh the context docs from the code · **/instructions** regenerate
[`CONTEXT_GUIDE.md`](docs/context/CONTEXT_GUIDE.md).

**Testing loops** — drive the real thing, don't reason about it: **/eve-test** talk to her out loud
through the ElevenLabs rig (preflight, the ten probes, the scenarios, evidence) · **/design-test**
front-end test of both design surfaces, including the technique/placement safeguards that stop art
landing on a product that cannot produce it.
