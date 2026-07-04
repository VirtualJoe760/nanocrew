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
   The forge is (correctly) an executor; all creative direction lives in Venus's authored brief,
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
pushed (new provisions clone it); the app change rides the normal Railway deploy. Existing
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
  the pre-generated live hero so Venus art-directs copy OVER a real photograph.
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
