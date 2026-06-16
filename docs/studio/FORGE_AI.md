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
| `briefs/01-BRAND.md` | `buildBrandBrief()` in `provision.ts` | the dynamic task — identity + the creator's `siteNotes` + the last ~24 transcript turns. **The mail-merge.** |
| `briefs/02-TEST.md` | `buildTestBrief()` in `provision.ts` | the acceptance gate (build clean, no new deps/routes, rails untouched, no placeholder text). |
| `TEMPLATE.md` / `VOCABULARY.md` | the chosen template repo | hard rules + a map from the creator's everyday words to blocks/files. |
| `CLAUDE.md` | the template repo | **an 11-byte file: `@AGENTS.md`.** A pointer, nothing else. |
| `AGENTS.md` | the template repo | **5 lines, generic**: a boilerplate "this Next.js has breaking changes, read the docs" notice. No brand/quality guidance. |
| `~/.claude/CLAUDE.md` (global) | the droplet | **does not exist.** There is no Master `CLAUDE.md` conditioning the robot. |

So all real steering lives in `briefs/01-BRAND.md` + `02-TEST.md`, **regenerated per job from a code
template**, plus the static `TEMPLATE.md`/`VOCABULARY.md`. There is no persistent, workflow-level
conditioning anywhere.

## How the brief is generated today — a mail-merge, not a prompt

`buildBrandBrief(input, template)` in `src/lib/provision.ts` is a **string template**. It interpolates
`brand.name`, tagline, mission, audience, voice, story, vibe keywords, products, logo direction,
texture/motion cues, the verbatim `siteNotes`, and `transcript.slice(-24)`, then appends a fixed
numbered to-do list (rewrite `copy.json`, write one launch blog post, refresh policy tone, align
`globals.css`, set metadata).

```ts
// src/lib/provision.ts — buildBrandBrief (abridged)
return `# 01-BRAND — ${brand.name}
You are branding a storefront for the clothing brand "${brand.name}". ...
## Identity
- Name: ${brand.name}
- Tagline: ${brand.tagline}
...
## What to do
1. Rewrite content/copy.json entirely in the brand's voice ...
2. Write one launch journal post ...
## The interview (the creator's own words — mine this for copy)
${convo}`;
```

**Why this is the root cause of weak builds:** it carries *data* but no *art direction* and no
*taste*. There is no instruction to establish a hero with real atmosphere, no instruction to replace
the template's stock placeholder products with on-brand temporary imagery, no rule that the primary
CTA must be styled/working, no anti-kitsch bar. The creator's intent is flattened into fields. This
is fix #4 in [`docs/storefront/BUILD_QUALITY.md`](../storefront/BUILD_QUALITY.md): *the brief is a
mail-merge — make Venus author it.*

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

1. **Venus authors a masterful prompt (replaces the mail-merge).** Instead of interpolating fields
   into a fixed template, an AI step composes `briefs/01-BRAND.md` as a real art-directed brief —
   establishing hero atmosphere, on-brand temporary imagery to stand in for missing products, styled
   working CTAs, and copy grounded in the creator's actual words. The `BrandResult` + transcript +
   `siteNotes` become the *input* to a prompt-author, not the prompt itself.
2. **A Master `CLAUDE.md` conditions the robot.** Add a global `~/.claude/CLAUDE.md` on the forge (it
   does not exist today) carrying the invariants every build must hold regardless of which brief
   generated it: you're branding a Nanocrew storefront; never substitute `brand.json` palette/
   typography; catalogue/auth/checkout come from the platform — don't reinvent the rails; make it
   **presentable** (no blank hero, no generic stock placeholders, working CTAs); always `pnpm run
   build` before finishing. This is the planned hardening already flagged in
   [`STOREFRONT_ENGINE.md`](../storefront/STOREFRONT_ENGINE.md) ("Where the builder's guidance comes
   from (and a gap)").
3. **Give the robot eyes + a self-critique loop.** Screenshot the built site, have the robot judge
   its own output against the brief and the quality checklist, and iterate before finishing — and
   stop swallowing failure: surface a real quality signal (not just `BUILD_OK`) so a weak build does
   **not** silently flip the store to `ready`. The annotated-screenshot rig (`~/critique-shot/`)
   already used for revisions is the natural foundation.

## When you touch this

- The brief generators (`buildBrandBrief` / `buildTestBrief`) and the worker's `claude` lines are a
  **mirror pair** — `src/lib/provision.ts` ↔ `forge-worker/worker.mjs`. Change one, change the other,
  and update this doc + [`docs/storefront/BUILD_QUALITY.md`](../storefront/BUILD_QUALITY.md).
- If you add the Master `CLAUDE.md`, document it here and flip the "does not exist" rows above.
- Removing a `|| true` or adding a real quality gate changes the `ready`-flip contract in
  `processProvision` — reflect it in [`STOREFRONT_ENGINE.md`](../storefront/STOREFRONT_ENGINE.md)'s
  pipeline description too.
