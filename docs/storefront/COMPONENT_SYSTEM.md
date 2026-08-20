# The jigsaw component system — `templates/_shared` + a block manifest (design)

> Status: **DESIGN / not yet built.** This folds in "Batch 4 (unify duplicated template UI)" — the
> duplication is resolved *by* this system, so it isn't a separate effort. Implementation is phased
> and build-gated (see Migration). Owner decision captured 2026-06-20: fold template-UI unification
> into this design rather than retrofit a shared lib blindly.

## Vision
Nano Crew should be a **jigsaw puzzle**: a creator assembles reusable pieces (blocks/components) into
their site, and in the background Eve + the forge turn that selection into **sophisticated,
deterministic install instructions** and build it. To get there, the storefront templates must move
from *hand-edited clones* to a system of **shared, declarative, typed pieces**.

## Current state (and why it blocks the vision)
- **Per-brand sites are clones of ONE template.** The forge build script does
  `cp -R templates/<template>/.` into a standalone repo ([forge-worker/worker.mjs:158-161](../../forge-worker/worker.mjs)).
  Only that template's files ship — there is no shared code in a per-brand repo.
- **5 templates duplicate** `header` / `footer` / `hero` / `button` / `product-card` /
  `platform-auth` / `site-config` / `seo` verbatim (the 2026-06-20 audit). A fix to one must be
  applied 5×, and they drift.
- **The forge hand-edits `app/*.tsx`** from a prose brief (`TEMPLATE.md` / `VOCABULARY.md`). There is
  no machine-readable manifest of installable blocks or typed slots, so the AI guesses from prose.
- **No typed platform-api contract** — templates hardcode endpoint fetches with inline shapes.

## Target architecture

### 1. `templates/_shared/` — the single source of truth
A shared folder for cross-template primitives, imported via a `@shared/*` tsconfig alias:
- **lib:** `platform-auth`, `site-config` (the live-read + merge), `api`, `seo`, brand types, and
  `contracts/` (typed platform-api interfaces).
- **components:** `BaseHeader`, `BaseFooter`, `BaseHero`, `BaseButton`, `BaseProductCard` — **theme-agnostic**
  (driven by CSS vars / a `theme` prop). Each template keeps a thin wrapper that supplies its aesthetic.

### 2. Forge vendoring (the `worker.mjs` change that makes it standalone)
Per-brand repos must stay self-contained (no external dependency, no npm publish infra), so the forge
**vendors** `_shared` into each repo on provision **and** revise:
- sparse-checkout `templates/${template}` **and** `templates/_shared`;
- `cp -R _shared` into the per-brand repo (e.g. `./_shared/`) and add the `@shared/*` path to its
  `tsconfig` (templates already ship a tsconfig);
- build-gate as today (`pnpm run build`), then push.
- **Requires a forge-worker redeploy** (worker.mjs mirrors `revise.ts`; re-scp to the droplet — see
  the `forge-worker-queue` memory). Existing live sites are unaffected until rebuilt.

### 3. `components.json` manifest (per template) — the declarative install surface
Declares the installable blocks + typed slots the forge composes from:
```jsonc
{
  "slots": [
    { "name": "hero", "options": ["Hero", "HeroVideo", "HeroCarousel"], "props": { "...": "..." } }
  ],
  "pages": ["/", "/about", "/shop"]
}
```
The forge reads **this** (not prose) to insert/swap blocks deterministically. This is the surface the
AI fills — the "sophisticated install instructions" are a validated manifest selection, not freeform edits.

### 4. Typed platform-api contract (`templates/_shared/contracts`)
Shared TS interfaces for every public endpoint (`site-config`, `site-assets`, `products`,
`collections`, `posts`). One change → all templates stay type-safe + versioned. See
[STOREFRONT_DATA_CONTRACT.md](STOREFRONT_DATA_CONTRACT.md) for the current shapes.

### 5. Machine-readable vocabulary (`templates/_shared/vocabulary.ts`)
A `phrase → block` map (e.g. `{ "slideshow": "HeroCarousel" }`) the forge validates briefs against,
replacing eyeballing `VOCABULARY.md`.

## End-to-end (the payoff)
User taps blocks in the app (pick a hero style, add a testimonial block) → that produces a **manifest
selection** (JSON) → Eve authors a precise brief from it, **validated against the vocabulary + slots**
→ the forge applies it by composing `_shared` blocks into the per-brand repo → build-gate → deploy.
No guessing; each component is defined once in `_shared`, not 5×.

## Migration plan (phased, build-gated, reversible)
- **5a — single source of truth for the client layer ✅ DONE (2026-06-20, low-risk copy+sync form).**
  `templates/_shared/lib/*` is now the canonical thin-client layer (`platform-auth`, `seo`,
  `site-config`, `api`, `content` — the 5 files byte-identical across the 4 standard templates), with
  **`scripts/sync-shared.mjs`** (+ `--check` for drift) copying it into each template's `lib/`. We
  deliberately chose **copy+sync over a tsconfig-alias + forge vendoring**: imports stay `@/lib/…`, so
  there is **no path magic, no `worker.mjs` change, no droplet redeploy, and zero production-coupling**
  — provisioning is untouched; only how WE maintain the layer changes (edit `_shared`, run sync,
  commit). street is excluded (its data layer diverges). See `nanocrew-templates/templates/_shared/README.md`.
  ⚠️ Run `node scripts/sync-shared.mjs --check` at the start of any templates session — the invariant
  has been violated before: the B9 contrast fix (2026-08-14) landed per-template without a backport to
  `_shared`, so `--check` currently fails and a blind sync would revert B9 fleet-wide (see
  [docs/ops/BUG_AUDIT_2026-08-20.md](../ops/BUG_AUDIT_2026-08-20.md)).
  - The heavier **tsconfig-alias + forge-vendoring** approach (below) remains the option IF we later
    want a literal single physical file + automatic vendoring; it's higher-risk (dual path resolution +
    a forge redeploy) and unnecessary for the maintenance win 5a already delivers.
- **5b — UI dedup (this IS Batch 4):** extract `Base{Header,Footer,Hero,Button,ProductCard}` to
  `_shared`; templates become thin theme wrappers.
- **5c — declarative install:** add `components.json` + make the forge read it.
- **5d — contracts + vocabulary:** add `contracts/` + `vocabulary.ts`; the forge validates briefs.

## Invariants / risks
- Per-brand repos stay **STANDALONE** (vendored `_shared`) → no publish/registry infra needed.
- Every step is **build-gated** before push; `worker.mjs` changes need a **forge-worker redeploy**.
- **Existing live sites are unaffected** until rebuilt; roll forward via re-provision or a targeted
  `_shared` backfill (same pattern as the logo / brand.json backfills).
- **street** diverges most (its own layout/components) — fold it in last; it can share the *libs*
  even if it keeps some bespoke blocks.

## Related
- [STOREFRONT_ENGINE.md](STOREFRONT_ENGINE.md) · [STOREFRONT_DATA_CONTRACT.md](STOREFRONT_DATA_CONTRACT.md)
- [../studio/FORGE_AI.md](../studio/FORGE_AI.md) — how the forge robot is conditioned + the brief.
- [../studio/BUILD_FLOW.md](../studio/BUILD_FLOW.md) — the build→refine→publish arc this sits inside.
