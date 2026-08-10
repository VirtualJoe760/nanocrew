# Forge Diversity — why every site looks the same, and the fix tracks

> Continuation of [FORGE_AI.md](FORGE_AI.md) (epic #31) and
> [BUILD_QUALITY.md](../storefront/BUILD_QUALITY.md). Those fixed *"the robot produces a bare
> template"*; this epic fixes *"every brand's site looks like every other brand's site"*.
> Reviewed 2026-07-04 (fonts pipeline, template/hero inventory, forge latitude — three deep reads).

## The diagnosis (three root causes)

1. **The font system is fully built — and never used.** A complete pipeline exists
   (`FONT_PRESETS` in the templates repo → `stores.site_config.fonts` → live CSS vars, no
   rebuild, plus the ✦ Customize picker) but **provision never wrote a font choice**. The
   interview's typography intent (`brand.designSystem.typography`, e.g. "bold grotesk") was
   stored as descriptive metadata that mapped to nothing. Every brand shipped on the template's
   single baked font / system sans.
2. **Four of five templates are literally the same page.** `minimal/bold/elegant/extravagant`
   share an identical `app/page.tsx` (Hero → Products → VideoGallery → StoryStrip → CtaBand,
   fixed order, no toggles). Three hero blocks exist per template (`hero`, `hero-video`,
   `hero-carousel`) but nothing *assigns* a variant per brand — everyone gets the default hero
   with different words. `placeholders.json` ships `imageUrl: null`, so heroes render as
   gradient tints: the "bare template" look.
3. **Brand personality is captured, then dropped.** `vibeKeywords`, `texture`, `motion`,
   `voice` reach the forge as **inert context** — no rule translates them into design decisions.
   The forge is (correctly) an executor; all creative direction lives in Eve's authored brief,
   and the brief isn't *required* to make typography/layout choices. The quality loop can't
   catch sameness: gate = "does it compile", revisions deploy even on BUILD_FAILED, and the
   sighted robot (FORGE_AI.md fix 3) is unshipped.

## Track 1 — Fonts *(SHIPPED 2026-07-04)*

Every new brand now gets its own typography at provision, before the first deploy:

- **`FONT_PRESETS` expanded** from 7 (+3 street-only) to **32 curated presets** in
  `nanocrew-templates/templates/_shared/lib/site-config.ts` (synced via
  `scripts/sync-shared.mjs`) **and** street's hand-kept `lib/site-config.ts`.
- **`src/lib/font-pairings.ts` (new)** — 6 sanctioned display/body **pairings per designStyle**
  (taste rails: no ransom-note combos), each tagged with personality keywords.
  `pickFontPairing(brand, slug)` scores pairings against the brand's own words
  (vibeKeywords + typography descriptors + voice) and breaks ties with a stable slug hash —
  **two same-vibe brands on the same template still land on different pairings**. Deterministic:
  same brand → same fonts.
- **Provision writes the choice** (`src/lib/provision.ts`): `stores.site_config.fonts` gets the
  pairing at provision time (live-read → applied from the first page load, no rebuild), but
  **only when unset** — a creator's ✦ Customize pick is never clobbered. `brand.json` gains a
  `fontPresets` mirror and the brief-author input states the choice as law.
- **✦ Customize picker** (`src/components/site-editor.tsx`) lists all 32 presets.

⚠ **Key sync point (three lists):** preset keys must exist in
`templates/_shared/lib/site-config.ts`, street's `lib/site-config.ts`, and be referenced by
`src/lib/font-pairings.ts` / the site-editor picker. Add the font to the templates first.

⚠ **Deploy:** the templates-repo change reaches production only when `nanocrew-templates` is
pushed (new provisions clone it); the app change rides the normal Cloud Run deploy. Existing
brands are untouched (their `site_config.fonts` is empty → template default, or their own pick).

## Track 2 — Heroes & layout *(hero decision + hero image SHIPPED 2026-07-04; layout knobs open)*

- ✅ **Provision-time hero image** (`src/lib/hero-image.ts`): ONE art-directed Nano Banana render
  from the brand's own interview data (vibe, palette, story, products; style-specific mood; 16:9
  with headline negative space; hard "no text" rule), hosted on Cloudinary and written to
  `stores.site_assets.hero.imageUrl` — the live-read slot every template's hero already prefers
  (`getHeroMedia`), so it needs ZERO template/forge changes and the creator's Design-tab pick
  replaces it any time. Only written when the hero slot is empty; best-effort (failure → the
  brand-tinted fallback, reason logged). Verified live: on-brand photorealistic hero in ~8s.
- ✅ **Hero decision required in the brief** (`briefAuthorSystem`): the brief must NAME the hero
  block (hero / hero-video / hero-carousel per TEMPLATE.md) with a one-line vibe justification —
  "do NOT silently accept the template default". The quality bar + IMAGES/VIDEO rules now state
  the pre-generated live hero so Eve art-directs copy OVER a real photograph.
- ⬜ **Variant props on existing blocks** (hero alignment/height/scrim/split; grid density) read
  from a `brand.json.layout` object — multiplies combinations with zero new components.
- ⬜ **Structural unlock**: replace the hardcoded `page.tsx` skeleton with an ordered
  `sections[]` list in `brand.json`, validated against TEMPLATE.md's block inventory —
  templates become block libraries with a default composition.

## Track 3 — Personality → design directives *(prompt work, cheap)*

- Brief gains a required **"design directives"** section translating vibeKeywords/texture/motion
  into concrete lever pulls; templates expose documented **expression hooks** (grain/glow/
  ticker utilities) in VOCABULARY.md; `forge-CLAUDE.md` gains the mirror rule: those fields
  must be *visibly expressed*.

## Track 4 — Quality loop *(FORGE_AI.md fix 3 + hardening)*

- Ship the **sighted robot** (post-build screenshot → judge vs. brief + a "bare-template test"
  → one self-revision pass; the droplet's critique-shot rig is the foundation).
- Stop swallowing failure: drop the `|| true` blindness; make `BUILD_FAILED` block the
  **revision** ready-flip (today only provision blocks it).
- Cheap deterministic check: diff built copy/fonts/hero against template defaults — untouched
  defaults = fail.


---

# EXPANSION PLAN v2 — Site Diversity (fonts × components × surfaces), 2026-07-05

> Joe: "our websites are looking too similar — fonts and components should be swapped… user
> preference is first… Google Font library at our users' fingertips… easy to adjust during
> brand review and afterwards on the CMS."
> Produced by a 4-map + design workflow; all paths verified against both repos.

# SITE DIVERSITY EXPANSION — Implementation Plan

Grounded in the four system maps (font pipeline, template structure, review/CMS surfaces, font-loading feasibility). All paths verified against both repos.

---

## 1. ARCHITECTURE — the font pipeline

### 1.1 Curation strategy: two tiers over ~1940 Google Fonts

- **Tier 1 — curated palette (the taste rail, default):** keep `FONT_PAIRINGS` in `/Users/averagexjoe/code/nanocrew/src/lib/font-pairings.ts` as the auto-pick brain, expanded from 6 → 12–16 pairings per designStyle (30 → ~70 total). Pairings may reference preset keys OR raw family descriptors (see 1.3). This is what the forge picks from and what "suggested pairings" chips show.
- **Tier 2 — full catalog (user's fingertips):** a server-cached copy of `https://fonts.google.com/metadata/fonts` (verified live: 1940 families, category/popularity/weights/per-weight metrics), with the keyed Developer API (`webfonts.googleapis.com/v1/webfonts?sort=popularity`) as stable fallback and as the source of direct TTF `files` URLs for native previews and OG images.
  - **New route:** `/Users/averagexjoe/code/nanocrew/src/app/api/fonts+api.ts` — GET returns trimmed `{ family, category, weights, popularity, subsets }[]` (top ~1000 by popularity + `?q=` search), cached in-memory/KV with 24h TTL. The picker UIs (both surfaces) read this; storefronts never need it, so no platform-api sibling is required.

### 1.2 Config schema change — `stores.site_config.fonts`

Generalize from preset keys to keys-or-descriptors (backward compatible, jsonb needs no migration):

```ts
type FontChoice = string /* legacy preset key */ | {
  family: string;            // exact Google family name, e.g. "Space Grotesk"
  weights?: number[];        // default [400,700]
  category?: 'serif'|'sans-serif'|'display'|'handwriting'|'monospace'; // drives fallback stack
};
fonts?: { display?: FontChoice; body?: FontChoice }
```

Touch points: shape doc comment at `src/db/schema.ts:128-133`; POST validation in `src/app/api/creator/site-config+api.ts` (currently accepts arbitrary strings — validate family against the cached catalog, whitelist weights); `platform-api/app/api/public/stores/[slug]/site-config/route.ts` is a pass-through, no change.

### 1.3 The resolver — one synced change unlocks everything

`getFontVars()` in `/Users/averagexjoe/code/nanocrew-templates/templates/_shared/lib/site-config.ts` (L111-120) becomes the single choke point:

- String value → resolve via `FONT_PRESETS` (L70-108) exactly as today (keeps every existing site's stored keys working).
- Object value → synthesize `stack = '"<family>", <category fallback stack>'` and css2 fragment `family=<Family+Name>:wght@<weights>` directly. One combined `fonts.googleapis.com/css2?...&display=swap` href, unchanged mechanism.
- Ship via `scripts/sync-shared.mjs` to minimal/bold/elegant/extravagant; **hand-mirror into `templates/street/lib/site-config.ts`** (street is excluded from sync, per its L74-77 header comment).

This is the right architecture per the feasibility findings: next/font/google cannot do runtime fonts (module-scope consts only — vercel/next.js #40345/#51358), so the existing runtime CSS2 `<link>` + CSS-var pipeline stays; we generalize the resolver, not the mechanism. "Build time" and "swap later" remain literally the same code path (provision writes site_config; templates live-read with `revalidate: 60`).

**Loading hardening (same PR):** add `<link rel="preconnect">` to fonts.googleapis.com and fonts.gstatic.com (crossorigin) in all 5 `app/layout.tsx` — currently zero preconnects exist; move street's font `<link>` from `<body>` (street layout.tsx ~L85) into `<head>`; keep `display=swap`. Later: metric-override `@font-face` fallbacks (size-adjust/ascent-override) generated from the metadata endpoint's per-weight metrics to zero CLS.

### 1.4 Diverse picking — style-driven + anti-repetition memory

Replace the 3 independent `pickFontPairing` call sites in `/Users/averagexjoe/code/nanocrew/src/lib/provision.ts` (L98 buildBrandJson, L272 briefAuthorInput, L451 site_config write) with a **resolve-once** flow at the top of `provisionStorefront()` (L415), threaded to all three consumers. Resolution order:

1. **User preference wins:** `brand.fonts` (new optional BrandResult field, set in brand review — see §3) → use verbatim.
2. Existing `site_config.fonts` already set → keep (current L450 guard, but change from "both unset" to **per-slot**: today a half-set config blocks the chooser entirely).
3. Otherwise `pickFonts(brand, slug, recentPicks)` — evolved `pickFontPairing`:
   - Corpus gains `brand.siteNotes` (currently omitted; only vibeKeywords/typography/voice at font-pairings.ts L78-83).
   - Tag matching upgraded from substring `includes` to word-boundary matching (fixes 'mono' matching 'monochrome').
   - **Anti-repetition memory:** query the last N (≈10) stores' `site_config.fonts` (`stores` ordered by createdAt desc; optionally scoped per creator) and demote candidates whose display family was used recently, before the djb2 hash tie-break (L64-68). With ~70 pairings, consecutive builds provably diverge. New helper `getRecentFontPicks()` in `src/lib/font-pairings.ts` or a new `src/lib/diversity.ts`.

`brand.json.fontPresets` (write-only ceremony — no template reads it) stays but carries the resolved descriptor; the brief (provision.ts L272) keeps stating it as law.

---

## 2. COMPONENT VARIANTS — variant registry over the real template structure

### 2.1 The raw material (from Map B)

The 4 standard templates share a **byte-identical `app/page.tsx`** (Hero → ProductGrid → VideoGallery → StoryStrip → CtaBand) and each ships **8 presentation blocks imported nowhere by default**: hero-video, hero-carousel, product-rail, marquee, lookbook, category-shelf, parallax-section, mobile-tabbar. Three hero implementations already exist per template. That means one config-driven page.tsx, written once, works ×4. Street is excluded initially (bespoke `components/layout/` tree, own API routes — same precedent as sync-shared).

### 2.2 Live variant channel: `site_config.layout`

Extend the proven no-rebuild contract (fonts/colors/copy) with a fourth section:

```ts
layout?: {
  hero?: { variant?: 'static'|'video'|'carousel'; align?: 'left'|'center'; height?: 'full'|'tall'|'standard'; scrim?: boolean };
  grid?: { density?: 'airy'|'standard'|'dense' };
  sections?: string[];  // ordered data-block names, e.g. ['hero','marquee','product-grid','lookbook','story','cta']
}
```

- App API: add `'layout'` to `SECTIONS` (`src/app/api/creator/site-config+api.ts:23`) — per-section merge already generic; add enum validation against the template's manifest (2.3).
- platform-api route: pass-through jsonb, no change.
- Template side (new, synced): `templates/_shared/lib/layout.ts` exporting `getLayout()` (reads getSiteConfig, applies brand.json `layout` defaults) and a `SECTION_REGISTRY` mapping data-block names → components (`hero: { static: Hero, video: HeroVideo, carousel: HeroCarousel }`, `'product-grid'`, `'video-gallery'`, `story`, `cta`, `marquee`, `'product-rail'`, `lookbook`, `'category-shelf'`, `parallax`). Registry imports resolve to `@/components/blocks/*` which exist under identical filenames in all 4 templates — so the registry file itself is syncable; each template's themed hero/story/etc. renders its own look.
- Rewrite the shared `app/page.tsx` to render `getLayout().sections` from the registry, defaulting to the current hardcoded order when `layout` is absent (zero visual change for unconfigured sites).
- **Extend `scripts/sync-shared.mjs`:** today it copies only `_shared/lib/*.ts` (TARGETS at L21-22). Add a second manifest covering `_shared/lib/layout.ts`, `_shared/app/page.tsx`, and the 12 already-byte-identical block files (posts-manager, product-grid, video-gallery, footer, etc.) that currently drift by hand — this also fixes the existing drift hazard.

### 2.3 `components.json` manifest (COMPONENT_SYSTEM.md phase 5c, already sketched at L44-53)

Per-template machine manifest declaring sections, variants, and option enums; names aligned with `data-block` attributes and `SITE_VOCABULARY` (`/Users/averagexjoe/code/nanocrew/src/lib/site-vocabulary.ts`, whose header comment explicitly anticipates this). Consumers: (a) picker UIs — what variants exist for this store's template; (b) site-config POST validation; (c) `authorBrandBrief()` (provision.ts L311) — upgrades the mandatory prose hero decision (briefAuthorSystem ~L231, FORGE_DIVERSITY track 2) into data.

### 2.4 Variant selection at provision

New `pickLayout(brand, slug, recentLayouts)` in `src/lib/layout-variants.ts`, same shape as pickFonts: vibe-scored options (e.g. `motion`/`texture` descriptors from `designSystem` — provision.ts already flows them to brand.json at L102/L146-147 with no consumer), slug-hash spread, anti-repetition against recent stores' `site_config.layout`. Written by `provisionStorefront` **only-when-unset** (same guard pattern as fonts), mirrored into brand.json as a `layout` field in `buildBrandJson()` (also add it and the missing `fontPresets` to the `Brand` type in each template's `lib/brand.ts` — types already drift from the JSON), and stated as law in the brief.

### 2.5 How the CMS swaps

Because page.tsx reads `site_config.layout` live, swapping a hero variant or reordering sections is an **instant** SiteEditor save (revalidate 60 + `revalidateStorefront`) — no forge run. Structural work beyond the registry (new blocks, custom sections) stays on the existing forge revision path (`store_revisions`, `revision/*` branches, preview→approve).

---

## 3. SURFACES — exact screens and components

### 3.1 Brand review (pre-build) — `/Users/averagexjoe/code/nanocrew/src/components/brand-review.tsx`

Currently NO font UI (only name/tagline/story at L79-102/L154-162, palette HSL at L105-139, template cards at L164-181). Add:

- **New TYPOGRAPHY card** between palette and template picker, following the existing patch/onChange pattern (L67) and horizontal-card-row pattern of TEMPLATES (L18-24): the auto-pick (call `pickFontPairing(brand, draftSlug)` client-side — it's pure and cheap) shown as the selected pairing chip, plus 4–5 alternate pairings from the style pool, plus a **"Browse all fonts" escape hatch** opening a new `FontLibrarySheet` component (`src/components/font-library.tsx`): search box, category tabs, popularity sort, fed by GET `/api/fonts`.
- **Live preview:** render each pairing chip's sample text ("Aa / headline + body line") in the actual typeface via `expo-font` `loadAsync` with remote TTF URLs from the catalog's Developer-API `files` (lazy, on-scroll, LRU-capped); also paint the template mock cards' headline (`renderMock` L207-271) in the chosen display font so template + palette + type preview together.
- **Data flow:** selection patches `brand.fonts = { display, body }` — new optional field on `BrandResult` (`src/lib/interview.ts:12-33`) — which flows unchanged through `createStore` (studio.tsx:974) → POST `/api/store` (`src/app/api/store+api.ts:63`) → `provisionStorefront`, where it wins over `pickFonts` (§1.4). Changing designStyle at review re-runs the default pick live.
- Phase 3 addition: a **hero-style chip row** (static/video/carousel wireframe glyphs) patching `brand.layout.hero.variant`, options read from the selected template's components.json.

### 3.2 CMS (post-launch) — `/Users/averagexjoe/code/nanocrew/src/components/site-editor.tsx` (opened from studio-composer.tsx "✦ Site Options", :1042-1054)

- **Replace the hardcoded 32-key `FONTS` array (L41-74) and label pills (L311-330)** with the same `FontLibrarySheet` — collapses one of the four hand-synced font lists. Keep two slots (display/body), keep blank = template default (L121 semantics), keep a "Suggested pairings" row from `FONT_PAIRINGS[store.designStyle]`. Pills render in their own typeface (same expo-font lazy load).
- **Live preview before save:** reuse the existing `SitePreview` WebView (`src/components/site-preview.tsx`) or embed a small preview WebView in SiteEditor, injecting `document.documentElement.style.setProperty('--brand-font-display', ...)` plus a css2 `<link>` via `injectedJavaScript` on selection — instant WYSIWYG; the real change lands on save via POST `/api/creator/site-config` (already instant-ish: live-read + revalidate).
- **New LAYOUT section** (phase 3): hero-variant pills + section toggles/reorder list, options from components.json (fetched via a small extension to GET `/api/creator/site-config` or a new `/api/creator/site-manifest` route), saved as the `layout` section. Copy in studio-composer.tsx (:772 "Exact edits, applied instantly…") already frames this two-speed split; also add a `layout` bucket to plan-site-edits' taxonomy (`src/app/api/creator/plan-site-edits+api.ts` SYSTEM prompt :20-32) so Eve voice edits can route "make the hero a video" to the instant channel instead of the forge.

---

## 4. PHASES

### Phase 1 — Full Google Fonts library + CMS picker (shippable alone) — **M**
User-visible: every creator can set any of 1940 fonts on their site today, with real typeface previews.
- **nanocrew-templates (S):** generalize `getFontVars()` + `FontChoice` in `templates/_shared/lib/site-config.ts`; run `scripts/sync-shared.mjs`; hand-mirror `templates/street/lib/site-config.ts`; add preconnects to all 5 `app/layout.tsx`; move street's font link to `<head>`.
- **nanocrew (M):** new `src/app/api/fonts+api.ts` catalog route (metadata cache + Developer API fallback); new `src/components/font-library.tsx`; rewire `src/components/site-editor.tsx` fonts section; add descriptor validation to `src/app/api/creator/site-config+api.ts` POST; schema doc comment `src/db/schema.ts:128-133`.
- Gate: full-library picker only for stores provisioned after the templates push (store a `configVersion` in brand.json via `buildBrandJson`, surfaced by GET site-config); older stores see the 32 presets. Optional backfill: push updated `lib/site-config.ts` to existing store repos via the GitHub contents API (the `updateBrandJson` pattern in `src/lib/brand-config.ts`) + rebuild.

### Phase 2 — Brand review typography + anti-repetition picking — **M**
User-visible: fonts adjustable at review (Joe's explicit ask); consecutive builds stop sharing fonts.
- `src/lib/interview.ts` `BrandResult.fonts`; `src/components/brand-review.tsx` TYPOGRAPHY card reusing font-library.tsx; `src/app/api/store+api.ts` thread-through.
- `src/lib/provision.ts`: resolve-once refactor (kill the 3 independent pickFontPairing calls at L98/L272/L451), prefer `brand.fonts`, per-slot unset guard.
- `src/lib/font-pairings.ts`: pools 6→12-16 per style, siteNotes in corpus, word-boundary tags, `pickFonts()` with recent-picks penalty (query last ~10 stores' site_config.fonts).

### Phase 3 — Component variants: hero + section order, live-swappable — **L**
User-visible: homepages structurally differ per brand; hero style and section lineup swappable instantly in the CMS.
- **nanocrew-templates:** `_shared/lib/layout.ts` + `SECTION_REGISTRY`; config-driven shared `app/page.tsx`; extend `scripts/sync-shared.mjs` to sync page.tsx + registry + the 12 identical block files; `components.json` per template; update TEMPLATE.md/VOCABULARY.md hard rules so the forge composes via `layout` data, not page.tsx edits.
- **nanocrew:** `'layout'` in SECTIONS + validation (site-config+api.ts); `src/lib/layout-variants.ts` `pickLayout()` + provision write (only-when-unset) + `buildBrandJson` `layout` field + brief-as-law; SiteEditor LAYOUT section; brand-review hero chip; `plan-site-edits` layout bucket; keep `src/lib/site-vocabulary.ts` aligned.
- **forge-worker:** no worker.mjs change needed (it clones whatever the template contains), but the revision-brief allowed-edit-surface prose (worker.mjs:84-90) should mention `site_config.layout` is the composition channel.

### Phase 4 — Polish, fleet, and street — **M**
- CLS metric-override fallback generation from metadata metrics (template layouts); parameterize `templates/street/app/opengraph-image.tsx` TTF fetch (L20-26) from the chosen display family; street layout-variant port or documented exclusion; backfill script to roll `configVersion` forward across existing store repos; generate the app-side preset/pairing lists from one source to permanently kill the multi-list sync; anti-repetition tuning (per-creator vs global memory); optional same-domain css2 proxy or self-host download via Developer API `files` (drop-in behind getFontVars).

---

## 5. RISKS / GOTCHAS

1. **Baked clones don't update:** every deployed site froze its `lib/site-config.ts` at provision. New resolver/registry reach only future builds; existing sites need the GitHub-contents backfill or a re-provision. Gate new UI on `configVersion` or descriptor picks silently render the template default (getFontVars returns null for unknowns — the current silent-failure mode).
2. **street is hand-kept:** every `_shared/lib` change must be mirrored manually (sync-shared.mjs excludes it, L12-13). Budget it into every templates PR or it will drift.
3. **The "both-unset" guard (provision.ts L450):** as written, a review-time pick of only a display font would block body-font auto-pick entirely. Must become per-slot in Phase 2.
4. **`fonts.google.com/metadata/fonts` is unofficial:** cache server-side, keep the keyed `webfonts` Developer API as fallback; never call it from clients.
5. **Anti-repetition breaks strict determinism:** today same brand+slug always yields same fonts; with memory, a re-provision may differ. Acceptable, but the dry-run path (`renderProvisionArtifacts`, provision.ts L343-375) and re-provisions should snapshot the resolved choice rather than re-pick.
6. **POST validation currently absent:** site-config accepts arbitrary strings for fonts; opening the surface to free-form family names makes validation (catalog membership, weight whitelist) mandatory or storefronts will emit broken css2 hrefs.
7. **Config-driven page.tsx changes the forge contract:** the forge currently expresses composition by editing page.tsx from the brief (worker.mjs:164, TEMPLATE.md hard rules). TEMPLATE.md/VOCABULARY.md and briefAuthorSystem must be updated in the same push, or forge sessions will fight the registry. worker.mjs and `src/lib/revise.ts` must stay in sync (documented invariant).
8. **RN font previews at scale:** 1940 remote TTFs can't be eagerly loaded — lazy on-scroll `expo-font` loads with an LRU cap, plain-label fallback while loading.
9. **Dead baked fonts:** elegant's next/font Playfair (layout.tsx L2/L14) and street's Anton/Inter/JetBrains still download when overridden — harmless now, worth pruning when the registry path is proven.
10. **Latency expectations:** live edits land in ~60s (revalidate) plus the belt-and-braces redeploy from `revalidateStorefront` — the picker UI's injected-CSS preview covers the gap so users don't perceive lag.
11. **`brand.json.fontPresets` is ceremony:** no template reads it; keep writing it (the brief treats it as law) but don't build on it — `stores.site_config` is the single runtime source of truth.
