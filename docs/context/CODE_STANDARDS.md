# Code Standards

How we write code in this repo. These formalize conventions that already exist (some were only in
people's heads). Hard rules that *break* things live in [`NEVER_VIOLATE.md`](NEVER_VIOLATE.md); this
doc is *how to write code that fits*.

## Language & types
- **TypeScript, `strict: true`.** No `any` to dodge a type — model the type. `tsc --noEmit` must be clean.
- **Path aliases:** `@/*` → `src/*`, `@/assets/*` → `assets/*`. Use them; don't write deep `../../..` chains.
- **Server vs client split:** authed creator logic lives in `src/app/**+api.ts` (server, Cloud Run).
  Client code calls it via **`apiFetch()`** (`src/lib/api.ts`) — it attaches the Supabase token.
  Never import a `src/lib/*` server module (printful, stripe, db) into client code.

## Naming & files
- **Components:** kebab-case filename, PascalCase export — `glow-button.tsx` → `GlowButton`. (The
  `src/components/designer/` folder is the one PascalCase-filename pocket; match its neighbors when
  editing inside it, otherwise prefer kebab-case.)
- **Platform splits:** `*.web.tsx` / `*.ios.tsx` / native — used for Skia/three/genai web-vs-native
  divergence. Keep the public prop shape identical across variants.
- **Libs:** kebab-case (`brand-identity.ts`, `pod-policy.ts`). One concern per file.

## UI
- **Reuse the primitives before styling a bare element.** `GlowButton` / `GlowInput` /
  `ThemedText` / `ThemedView` exist for this. The rules + the registry of what exists (and what's
  still missing) are in [`UI_RULES.md`](UI_RULES.md) and [`UI_REGISTRY.md`](UI_REGISTRY.md). Tokens
  (colors/spacing/type) come from [`UI_TOKENS.md`](UI_TOKENS.md) — never hardcode a hex or a pixel
  margin that a token covers.

## Error handling
- **Money paths debit-then-refund.** Credit-gated AI routes (`src/lib/credits.ts`) debit *before* the
  model call and **refund on failure** — never leave a charge stranded on an error. Skip the internal
  identity (`internal@nanocrew`). The debit is atomic (single guarded `UPDATE … WHERE balance >=`).
- **No swallowed failures on quality gates.** Don't `|| true` a build/quality step into green — the
  forge `ready`-flip bug came from exactly that. Fail loudly or set the honest status.
- **Tenancy throws, doesn't 200.** Ownership mismatches throw `TenantError(…, 403)` — see
  [`NEVER_VIOLATE.md`](NEVER_VIOLATE.md) §1.

## Verify the latest docs before you code (APIs drift fast)
Expo SDK, React Native, and AI model IDs move faster than training data. **Before writing code
against them, confirm the current API** by web search or a docs lookup — don't trust memory.
- This repo is on **Expo SDK 54** (`package.json` `expo: ~54.0.0`) — read
  `https://docs.expo.dev/versions/v54.0.0/`, not a newer version's docs.
- Model IDs (Gemini / fal / Veo) are pinned in [`../architecture/TECH_STACK.md`](../architecture/TECH_STACK.md);
  re-check them there (and upstream) rather than guessing.

## The working loop (automatic — you don't have to ask)
Memory and review are **behaviors, not commands** — they happen on every change without being invoked:

- **Auto-memory.** The doc for the view/space being worked on gets updated **in the same change** —
  no separate "remember" step. New decisions/conventions land in their canonical doc
  ([NEVER_VIOLATE](NEVER_VIOLATE.md) / [CODE_STANDARDS](CODE_STANDARDS.md) / the `UI_*` docs / a
  division doc) as the work happens.
- **Auto-review.** Before each commit, self-run `tsc` + `expo lint` and the sync checks
  (schema-copy, palette ×3, RLS on new migrations); `npx expo export` before a push. No one has to
  invoke a review — it's part of committing.
- **Commit often, no gate.** Commit at each logical milestone **automatically** — Joe does not review
  before a commit. Push to the working branch at sensible points. End every message with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. (Say "hold commits" / "don't push" to override.)
- **Branch off `main`** for features; site edits are branch-based (`revision/<id>`), never on a brand's `main`.
