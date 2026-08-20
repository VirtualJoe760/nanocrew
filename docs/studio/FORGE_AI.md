# Forge AI — how our AI talks to the forge robot

**This is the seam where build quality is won or lost, and it is the heart of a live improvement
effort.** The forge "robot" is a headless `claude` session running on the DO droplet that turns a
template into a brand. Everything it does is determined by the text we hand it. Today that text is
**AI-authored** (`authorBrandBrief()`), the robot is **conditioned** by the Master `CLAUDE.md`, and
the worker **fails jobs loudly** on `CLAUDE_FAILED`/`NO_EDITS` (and `BUILD_FAILED`, on provision)
instead of swallowing them (2026-08-19). The remaining gap is the **visual self-check** — the robot
still never LOOKS at its own first build (the A/B evidence that drove the fixes is in
[`docs/storefront/BUILD_QUALITY.md`](../storefront/BUILD_QUALITY.md)).

This doc makes the seam legible and tracks the remaining plan, grounded in the actual code.

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
| `VOCABULARY.md` | the chosen template repo | the creator-words → block dictionary. **Read by Eve when she authors the provision brief, NOT by the forge on provision** — but the **revision** brief still points the robot at it (revision requests arrive in the creator's own words). |
| `CLAUDE.md` | the template repo | **an 11-byte file: `@AGENTS.md`.** A pointer, nothing else. |
| `AGENTS.md` | the template repo | **5 lines, generic**: a boilerplate "this Next.js has breaking changes, read the docs" notice. No brand/quality guidance. |
| `~/.claude/CLAUDE.md` (global) | the droplet (source: `forge-worker/forge-CLAUDE.md`) | **The Master `CLAUDE.md`** — the standing rulebook the robot holds on **every** build + revision: data-is-law, the off-limits rails, the anti-kitsch quality bar, the temporary-imagery rule, faithfulness to the creator, and "always build + self-check before finishing." |

So the **persistent, workflow-level conditioning** now lives in the Master `CLAUDE.md`, and the
**per-brand art direction** lives in `briefs/01-BRAND.md` (AI-authored) + `02-TEST.md`, alongside the
static `TEMPLATE.md`. **`VOCABULARY.md` is no longer a *provision* input** — Eve reads it when she
authors the brief (she does the interpreting), so the forge receives a concrete, block-by-block plan
and never decodes the creator's words itself. The **revision** brief still points the robot at it,
because revision requests arrive in the creator's own words.

## How the brief is generated — AI-authored (was a mail-merge)

`authorBrandBrief(input, template)` in `src/lib/provision.ts` calls `gemini-2.5-pro` (reusing the
`@google/genai` client that powers the interview) to **compose** `briefs/01-BRAND.md` as a real,
art-directed, **block-by-block** build prompt. This is **Eve doing the interpreting**: the system
prompt (`briefAuthorSystem()`) casts the model as Eve (creative director + senior Next.js engineer)
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
  contents: [{ role: 'user', parts: [{ text: briefAuthorInput(input, template, templateMd, vocabMd) }] }],
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
(*make Eve author the brief*) is now **shipped** via `authorBrandBrief()`; the mail-merge survives
only as the never-break fallback.

`buildTestBrief()` is similarly mechanical: it gates on **compilation + "no literal placeholder
text"**, never on whether the site *looks good*.

## The two `claude` invocations on the forge

Both live in `forge-worker/worker.mjs` (the systemd worker that drains the queue). The forge bash
lives **only** there — editing it ships nothing until it is re-scp'd to the droplet.
`src/lib/provision.ts` authors the queue payload; `src/lib/revise.ts` handles approve/decline via
the GitHub API. There is no in-repo mirror of the `claude` lines to keep in sync.

**Provision** — `buildProvisionScript()`, the `claude` line is ~line 177:

```bash
if claude -p "Read briefs/01-BRAND.md and apply it to this storefront. Then verify every item in \
briefs/02-TEST.md and fix anything that fails." --dangerously-skip-permissions --max-turns 80 \
< /dev/null > /tmp/${repo}-claude.log 2>&1; then
  echo CLAUDE_OK
else
  echo CLAUDE_FAILED
  tail -3 /tmp/${repo}-claude.log
fi
pnpm run build > /tmp/${repo}-build.log 2>&1 && echo "BUILD_OK" || echo "BUILD_FAILED"
```

**Revise** — `buildScript()`, the `claude` line is ~line 128:

```bash
if claude -p "Read $BRIEF and look at any images in briefs/screenshots/, then apply exactly that \
change. Then run pnpm run build and fix anything you broke." --dangerously-skip-permissions \
--max-turns 60 < /dev/null > /tmp/${repo}-revise.log 2>&1; then
  echo CLAUDE_OK
else
  echo CLAUDE_FAILED
  tail -3 /tmp/${repo}-revise.log
fi
pnpm run build > /tmp/${repo}-revise-build.log 2>&1 && echo BUILD_OK || echo BUILD_FAILED
# after staging: NO_EDITS when nothing outside briefs/ changed — the robot ran but did nothing
```

### Three structural weaknesses — two now fixed, one open

1. **✅ FIXED 2026-08-19 — the `|| true` exit-code swallow.** Both `claude` invocations now report
   `CLAUDE_OK`/`CLAUDE_FAILED`, and the revise script emits `NO_EDITS` when the robot ran but
   changed nothing outside `briefs/`. `CLAUDE_FAILED` fails the provision (store → `draft`, failed
   `store_revisions` row) and fails the revision; `NO_EDITS` fails the revision too — and every
   failure path push-notifies the creator.
2. **`pnpm build` now gates provision for real — but not revisions.** `BUILD_FAILED` blocks the
   provision (no deploy, store → `draft`, failed job, creator push-notified); the **revision** path
   still merely *logs* `build failing on ${row.branch}` and flips the revision to `ready` anyway —
   the remaining hole ([FORGE_DIVERSITY.md](FORGE_DIVERSITY.md) track 4). And a site that compiles
   but looks broken still ships exactly like a good one.
3. **The robot is blind.** It runs `claude -p … < /dev/null` one-shot with no screenshot, no preview,
   no self-critique. It cannot see that the hero is blank or that coffee-bean placeholders are
   showing through. (Revisions receive the creator's real marked-up on-device screenshots when the
   app sent them — the annotation `shotUrls`, downloaded into `briefs/screenshots/` — falling back
   to a `~/critique-shot/render.mjs` re-render when no shot was provided; but the **provision** path
   has no eyes at all.)

This is fix #6 in [`docs/storefront/BUILD_QUALITY.md`](../storefront/BUILD_QUALITY.md): *no eyes, no
self-check* (the silent-failure third was fixed 2026-08-19).

## The vulnerability, stated plainly

> Nothing in the loop ever **LOOKS** at the built site — the robot is judged by exit code and
> compilation, never by pixels. The brief is authored, the robot conditioned, and failure now fails
> loudly; but "does this look like a brand?" is still never asked, so whatever the robot produces
> on the first pass is what the creator sees.

The shape of the pipeline is sound (templates + tokens keep cost flat and architecture safe). The
gap is entirely in *how we talk to the robot and how we judge its work*.

## The plan — condition the robot, give it taste, give it eyes

Three coordinated fixes, mapped to the build-quality epic:

1. **✅ SHIPPED — Eve authors a masterful prompt (replaces the mail-merge).** `authorBrandBrief()`
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
   self-check before finishing. (Install line in `forge-worker/README.md`.) **Now also carries the
   "copy is data" rule** (added 2026-06-17): `content/copy.json` is the single source of all prose;
   never hardcode a headline/subline/CTA as a string literal or a default prop — a baked default
   *shadows* `copy.json` in the blocks' fallback chain and silently eats later edits. This closed the
   **edit-fidelity gap** (a green copy edit that never rendered) — see BUILD_QUALITY.md root-cause #7;
   the matching template fix removed `HeroVideo`'s hardcoded `'Discover'` default in all 4 templates.
3. **Give the robot eyes + a self-critique loop.** The stop-swallowing half **✅ shipped
   2026-08-19**: `CLAUDE_FAILED`/`NO_EDITS` fail the job and `BUILD_FAILED` blocks the provision
   ready-flip, all push-notifying the creator. Still open: screenshot the built site, have the robot
   judge its own output against the brief and the quality checklist, and iterate before finishing —
   and make `BUILD_FAILED` block the **revision** ready-flip too. The annotated-screenshot rig
   (`~/critique-shot/`) already used for revisions is the natural foundation.

## Testing the flow (no UI, no interview)

`scripts/studio-flow.ts` replays the whole Studio flow from a JSON file — see
`scripts/studio-flow/*.example.json` for the shapes (`kind: build | rebuild | edit`).

- **Fast build-quality loop (no spend):** `npx tsx --env-file=.env.local scripts/studio-flow.ts
  scripts/studio-flow/build.example.json --dry` — renders **every prompt** to
  `scripts/studio-flow/out/<slug>/` for review (Eve's author system prompt + her full input incl.
  the template docs, the authored `01-BRAND.md`, `02-TEST.md`, `brand.json`, the Master `CLAUDE.md`,
  and the forge command). No repo, no forge, no Vercel; one Gemini call. Iterate on
  `briefAuthorSystem()` here.
- **Full test build:** drop `--dry` to create a throwaway test store + fire the real forge
  pipeline (the droplet worker drains it). `rebuild` re-fires an existing slug (e.g. `alpha-master`)
  to A/B the quality jump; `edit` enqueues a revision the worker applies on a branch.

## When you touch this

- The brief content is authored on the **app server** (`authorBrandBrief` / `buildBrandBriefFallback`
  / `buildTestBrief` in `src/lib/provision.ts`); the worker just writes whatever brief string the
  queue payload carries. So changing the brief *content* does NOT touch the worker. The forge bash —
  including the `claude` invocation lines — lives **only** in `worker.mjs` (there is no in-repo
  mirror); editing it ships nothing until it is re-scp'd to the droplet. Update this doc +
  [`docs/storefront/BUILD_QUALITY.md`](../storefront/BUILD_QUALITY.md) when it changes.
- The Master `CLAUDE.md` lives at `forge-worker/forge-CLAUDE.md` (source) → `/home/forge/.claude/CLAUDE.md`
  (droplet). Edit both and keep this doc's input table in sync.
- Adding a further quality gate changes the `ready`-flip contract in `processProvision` /
  `processOne` (the 2026-08-19 failure gates already did) — reflect it in
  [`STOREFRONT_ENGINE.md`](../storefront/STOREFRONT_ENGINE.md)'s pipeline description too.

## Continuation: diversity

The "every site looks the same" arc (fonts, hero variety, personality→design, quality loop)
continues in [FORGE_DIVERSITY.md](FORGE_DIVERSITY.md) — track 1 (per-brand font pairings at
provision) shipped 2026-07-04.
