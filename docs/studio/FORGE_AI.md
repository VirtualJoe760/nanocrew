# Forge AI — how our AI talks to the forge robot

**This is the seam where build quality is won or lost, and it is the heart of a live improvement
effort.** The forge "robot" is a headless `claude` session running on the DO droplet that turns a
template into a brand. Everything it does is determined by the text we hand it. Today that text is a
**code mail-merge**, the robot is **almost completely unconditioned**, and its failures are
**silently swallowed** — which is exactly why a fresh build looks like a barely-configured template
(see the A/B evidence in [`docs/storefront/BUILD_QUALITY.md`](../storefront/BUILD_QUALITY.md)).

This doc makes that vulnerability legible and lays out the plan, grounded in the actual code.

> Scope: the *messaging* into the robot. The surrounding pipeline (queue, clone, deploy) is
> [`docs/storefront/STOREFRONT_ENGINE.md`](../storefront/STOREFRONT_ENGINE.md). The data the site
> reads is [`docs/storefront/STOREFRONT_DATA_CONTRACT.md`](../storefront/STOREFRONT_DATA_CONTRACT.md).

## What the robot reads (the full set of inputs)

When the forge invokes `claude`, its behavior is steered by exactly these, and nothing else:

| Input | Source | What it is |
|---|---|---|
| `brand.json` | written deterministically by `buildBrandJson()` in `src/lib/provision.ts` | the token contract (palette, typography, slug, `apiBase`, …). Hard data; the robot may not invent it. |
| `briefs/01-BRAND.md` | **`authorBrandBrief()`** in `provision.ts` (AI-authored; `buildBrandBriefFallback()` mail-merge if the model key is missing/the call fails) | the dynamic task — a masterful, art-directed build prompt composed by `gemini-2.5-pro` from the `BrandResult` + `siteNotes` + transcript. |
| `briefs/02-TEST.md` | `buildTestBrief()` in `provision.ts` | the acceptance gate (build clean, no new deps/routes, rails untouched, no placeholder text). |
| `TEMPLATE.md` | the chosen template repo | the spec: blocks that exist, their props, hard rules, the page skeleton. The forge composes from this. |
| `VOCABULARY.md` | the chosen template repo | the creator-words → block dictionary. **Read by Venus when she authors the brief, NOT by the forge** — interpretation happens on Venus's side; the forge executes a concrete plan. |
| `CLAUDE.md` | the template repo | **an 11-byte file: `@AGENTS.md`.** A pointer, nothing else. |
| `AGENTS.md` | the template repo | **5 lines, generic**: a boilerplate "this Next.js has breaking changes, read the docs" notice. No brand/quality guidance. |
| `~/.claude/CLAUDE.md` (global) | the droplet (source: `forge-worker/forge-CLAUDE.md`) | **The Master `CLAUDE.md`** — the standing rulebook the robot holds on **every** build + revision: data-is-law, the off-limits rails, the anti-kitsch quality bar, the temporary-imagery rule, faithfulness to the creator, and "always build + self-check before finishing." |

So the **persistent, workflow-level conditioning** now lives in the Master `CLAUDE.md`, and the
**per-brand art direction** lives in `briefs/01-BRAND.md` (AI-authored) + `02-TEST.md`, alongside the
static `TEMPLATE.md`. **`VOCABULARY.md` is no longer a forge input** — Venus reads it when she
authors the brief (she does the interpreting), so the forge receives a concrete, block-by-block plan
and never decodes the creator's words itself.

## How the brief is generated — AI-authored (was a mail-merge)

`authorBrandBrief(input, template)` in `src/lib/provision.ts` calls `gemini-2.5-pro` (reusing the
`@google/genai` client that powers the interview) to **compose** `briefs/01-BRAND.md` as a real,
art-directed, **block-by-block** build prompt. This is **Venus doing the interpreting**: the system
prompt (`briefAuthorSystem()`) casts the model as Venus (creative director + senior Next.js engineer)
and tells her to resolve the creator's loose words into concrete blocks; the user content
(`briefAuthorInput()`) is the structured `BrandResult` + verbatim `siteNotes` + transcript **plus the
chosen template's `TEMPLATE.md` and `VOCABULARY.md`**, fetched from the templates repo via
`fetchTemplateDoc()`. The brief that reaches the forge names exact blocks/files, so the forge never
decodes the creator. If `GOOGLE_GENAI_API_KEY`/`GEMINI_API_KEY` is missing or the call fails, it
falls back to **`buildBrandBriefFallback()`** — the old deterministic string template (identity
fields + `siteNotes` + `transcript` + a fixed to-do, mapping wishes via `TEMPLATE.md`'s keyword
hints) — so provisioning never breaks.

```ts
// src/lib/provision.ts — authorBrandBrief (abridged)
const res = await ai.models.generateContent({
  model: 'gemini-2.5-pro',
  contents: [{ role: 'user', parts: [{ text: briefAuthorInput(input, template) }] }],
  config: { systemInstruction: briefAuthorSystem(), temperature: 0.8 },
});
const md = res.text?.trim();
if (!md || !md.includes('# 01-BRAND')) throw new Error('author returned an unusable brief');
return md; // → catch → buildBrandBriefFallback(input, template)
```

**Why the old mail-merge was the root cause of weak builds (the fallback still is):** a string
template carries *data* but no *art direction* and no *taste* — no instruction to establish a hero
with real atmosphere, to replace the template's stock placeholder products with on-brand temporary
imagery, to make the primary CTA styled/working, and no anti-kitsch bar. The creator's intent is
flattened into fields. **Fix #4** in [`docs/storefront/BUILD_QUALITY.md`](../storefront/BUILD_QUALITY.md)
(*make Venus author the brief*) is now **shipped** via `authorBrandBrief()`; the mail-merge survives
only as the never-break fallback.

`buildTestBrief()` is similarly mechanical: it gates on **compilation + "no literal placeholder
text"**, never on whether the site *looks good*.

## The two `claude` invocations on the forge

Both live in `forge-worker/worker.mjs` (the systemd worker that drains the queue). The bash is a
hand-kept mirror of `src/lib/provision.ts` / `src/lib/revise.ts`.

**Provision** — `buildProvisionScript()`, the `claude` line is ~line 157:

```bash
claude -p "Read briefs/01-BRAND.md and apply it to this storefront. Then verify every item in \
briefs/02-TEST.md and fix anything that fails." --dangerously-skip-permissions --max-turns 80 \
< /dev/null > /tmp/${repo}-claude.log 2>&1 || true
pnpm run build > /tmp/${repo}-build.log 2>&1 && echo "BUILD_OK" || echo "BUILD_FAILED"
```

**Revise** — `buildScript()`, the `claude` line is ~line 116:

```bash
claude -p "Read $BRIEF and look at any images in briefs/screenshots/, then apply exactly that \
change. Then run pnpm run build and fix anything you broke." --dangerously-skip-permissions \
--max-turns 60 < /dev/null > /tmp/${repo}-revise.log 2>&1 || true
pnpm run build > /tmp/${repo}-revise-build.log 2>&1 && echo BUILD_OK || echo BUILD_FAILED
```

### Three structural weaknesses, visible right in those lines

1. **Both `claude` commands end in `|| true`** — the robot's exit code is **swallowed**. If the
   session errors, crashes, or does nothing, the pipeline continues as if it succeeded.
2. **`pnpm build` is the *only* quality gate.** After the swallowed `claude` run, the only signal is
   whether the project compiles. `BUILD_FAILED` is merely *logged* (`processProvision` logs
   `build failing for ${repo}` and **still flips the store to `ready` and deploys**). A site that
   compiles but looks broken ships exactly like a good one.
3. **The robot is blind.** It runs `claude -p … < /dev/null` one-shot with no screenshot, no preview,
   no self-critique. It cannot see that the hero is blank or that coffee-bean placeholders are
   showing through. (Revisions *can* receive annotated screenshots rendered into `briefs/screenshots/`
   via `~/critique-shot/render.mjs` — but the **provision** path has no eyes at all.)

This is fix #6 in [`docs/storefront/BUILD_QUALITY.md`](../storefront/BUILD_QUALITY.md): *no eyes, no
self-check, silent failure.*

## The vulnerability, stated plainly

> We hand an **unconditioned** robot a **data-only mail-merge**, run it **one-shot and blind**,
> **swallow its exit code**, gate solely on **"does it compile"**, and then **deploy and mark the
> store `ready` regardless**. Nothing in the loop ever asks "does this look like a brand?" — so
> whatever the robot produces on the first pass is what the creator sees.

The shape of the pipeline is sound (templates + tokens keep cost flat and architecture safe). The
gap is entirely in *how we talk to the robot and how we judge its work*.

## The plan — condition the robot, give it taste, give it eyes

Three coordinated fixes, mapped to the build-quality epic:

1. **✅ SHIPPED — Venus authors a masterful prompt (replaces the mail-merge).** `authorBrandBrief()`
   in `src/lib/provision.ts` calls `gemini-2.5-pro` to compose `briefs/01-BRAND.md` as a real
   art-directed brief — establishing hero atmosphere, on-brand temporary imagery to stand in for
   missing products, styled working CTAs, and copy grounded in the creator's actual words. The
   `BrandResult` + transcript + `siteNotes` are the *input* to the prompt-author, not the prompt
   itself. The deterministic mail-merge (`buildBrandBriefFallback()`) survives only as the never-break
   fallback when the model key is missing or the call fails.
2. **✅ SHIPPED — a Master `CLAUDE.md` conditions the robot.** `forge-worker/forge-CLAUDE.md` is
   deployed to `/home/forge/.claude/CLAUDE.md` (loaded for every build + revision) carrying the
   invariants every build must hold regardless of which brief generated it: you're branding a
   Nano Crew storefront; never substitute `brand.json` palette/typography; catalogue/auth/checkout
   come from the platform — don't reinvent the rails; make it **presentable** (no blank hero, no
   generic stock placeholders, working CTAs); be faithful to the creator; always `pnpm run build` +
   self-check before finishing. (Install line in `forge-worker/README.md`.)
3. **Give the robot eyes + a self-critique loop.** Screenshot the built site, have the robot judge
   its own output against the brief and the quality checklist, and iterate before finishing — and
   stop swallowing failure: surface a real quality signal (not just `BUILD_OK`) so a weak build does
   **not** silently flip the store to `ready`. The annotated-screenshot rig (`~/critique-shot/`)
   already used for revisions is the natural foundation.

## Testing the flow (no UI, no interview)

`scripts/studio-flow.ts` replays the whole Studio flow from a JSON file — see
`scripts/studio-flow/*.example.json` for the shapes (`kind: build | rebuild | edit`).

- **Fast build-quality loop (no spend):** `npx tsx --env-file=.env.local scripts/studio-flow.ts
  scripts/studio-flow/build.example.json --dry` — renders **every prompt** to
  `scripts/studio-flow/out/<slug>/` for review (Venus's author system prompt + her full input incl.
  the template docs, the authored `01-BRAND.md`, `02-TEST.md`, `brand.json`, the Master `CLAUDE.md`,
  and the forge command). No repo, no forge, no Vercel; one Gemini call. Iterate on
  `briefAuthorSystem()` here.
- **Full test build:** drop `--dry` to create a throwaway test store + fire the real forge
  pipeline (the droplet worker drains it). `rebuild` re-fires an existing slug (e.g. `alpha-master`)
  to A/B the quality jump; `edit` enqueues a revision the worker applies on a branch.

## When you touch this

- The brief content is authored on the **app server** (`authorBrandBrief` / `buildBrandBriefFallback`
  / `buildTestBrief` in `src/lib/provision.ts`); the worker just writes whatever brief string the
  queue payload carries. So changing the brief *content* does NOT touch the worker. The worker's
  `claude` invocation **lines** (`provision.ts` ↔ `forge-worker/worker.mjs`) are still a mirror pair —
  change one, change the other, and update this doc + [`docs/storefront/BUILD_QUALITY.md`](../storefront/BUILD_QUALITY.md).
- The Master `CLAUDE.md` lives at `forge-worker/forge-CLAUDE.md` (source) → `/home/forge/.claude/CLAUDE.md`
  (droplet). Edit both and keep this doc's input table in sync.
- Removing a `|| true` or adding a real quality gate changes the `ready`-flip contract in
  `processProvision` — reflect it in [`STOREFRONT_ENGINE.md`](../storefront/STOREFRONT_ENGINE.md)'s
  pipeline description too.
