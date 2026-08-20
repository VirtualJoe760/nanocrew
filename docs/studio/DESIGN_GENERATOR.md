# Design Generator — making the brand's real product world

The **Design tab** (`src/app/design.tsx`) is where a creator turns the build's *presentable*
storefront into a *finished* one: they generate AI artwork, drop it onto real Printful apparel,
publish products, and add on-model photo galleries and "cool short" scene videos. These are the
assets that **progressively replace the temporary placeholders** the forge shipped (see
[BUILD_FLOW.md](BUILD_FLOW.md) step 3 and
[`docs/storefront/BUILD_QUALITY.md`](../storefront/BUILD_QUALITY.md)).

How those assets reach the *live* site is governed by the data contract — referenced throughout, not
duplicated:

> **➜ [`docs/storefront/STOREFRONT_DATA_CONTRACT.md`](../storefront/STOREFRONT_DATA_CONTRACT.md)** —
> the app's Postgres is the only catalogue; the live site reads it via platform-api; publish/delete
> fire `revalidateStorefront(slug)`.

## The canvas (`src/app/design.tsx`)

A freeform spatial canvas (`DesignCanvas`), organized around **catalogues** (= collections / drops,
DB-backed via `/api/catalogues` + `/api/canvas/[id]`, debounce-saved). Three node kinds matter:

- **design** — a generated/uploaded artwork tile (top history bar; tap to drop on the canvas).
- **template** — a Printful blank picked in the **ProductPicker** modal (the full catalogue,
  `/api/blanks`); the bottom dock holds the design history, not products. Tap a placed product to
  open the **ProductDetailSheet** and pick its **colour** (`/api/blank/:id/variants`).
- **composition** — a design printed on a blank. Formed by dragging a design onto a product (the
  "click" → the **Combine** sheet picks a print placement, `/api/blank/:id/placements`), or by the
  blend tool. Members spring into a grouped row.

The canvas affordances: **merge** two designs (`/api/merge`), **combine** a design + product into a
composition (`/api/compositions` → on-garment render `/api/composite`), a **PlacementEditor**
(size/position + real Printful mockups), and a **FinalizeSheet** (name, variants, price → publish).
A pulsing red **Generate** FAB nudges the next step whenever a product is on the canvas without a
design.

## Generation — making artwork (`/api/generate`, `/api/merge`)

`generate()` posts the prompt (+ optional reference image, transparent/filled background, aspect
ratio) to `/api/generate`; an uploaded image with no prompt is stored directly as a design
(`/api/designs`). Designs persist with a hosted Cloudinary URL so downstream nodes reference durable
assets. Generation is credit-gated and Nano-Banana-backed.

> Nano Banana can't emit alpha → the magenta chroma-key trick in `src/lib/transparency.ts` produces
> transparent PNGs. This works for BOTH printable designs (1:1) AND **web assets** (Graphics mode —
> a transparent logo/emblem/banner at the chosen web ratio like 16:9). Two things had to be fixed:
> (1) `buildConstraints()`'s transparent branch used to hard-force "Square 1:1" + a "garment print"
> framing; it's now context-neutral and asks for a clear magenta margin so `keyOutMagenta`
> (aspect-agnostic — samples the border ring on all four sides) keys cleanly. (2) **Aspect ratio must
> be set via `config.imageConfig.aspectRatio`** — `gemini-2.5-flash-image` IGNORES aspect ratio in the
> prompt text and returns ~square, so a 16:9 hero came out square until we passed `imageConfig`
> (validated against the API's supported set — `GEMINI_RATIOS`; an unsupported value like the product
> picker's `4:5` is omitted to avoid a 400, falling back to the model default). Verified live: a
> transparent 16:9 request → 1056×577, 82% transparent.

**Technique-aware generation (2026-08-20).** Not every Printful blank is printed: caps are
EMBROIDERED, sweaters are KNITWEAR. `/api/generate` takes an optional `templateKey` (the destination
blank) and, for the constrained techniques in `src/lib/technique.ts`, appends a fabrication
constraint to `buildConstraints()` (embroidery: bold shapes, ≤6 solid thread colors, no gradients or
fine detail; knit: flat fills, ≤4 colors). The design row and the response carry `technique`, and
`/api/compositions` skips its adaptation pass for art that was born technique-ready. Eve always
knows the blank before generating so her flow passes `templateKey`; the tab's canvas generates
product-blind and relies on the composition-time adaptation (`lib/adapt.ts`, now KNITWEAR **and**
EMBROIDERY). Surfacing: the shared `ProductPicker` shows a technique chip, the tab alerts on
adaptation, and Eve says it aloud — the parity story is in
[`DESIGN_SURFACES.md`](DESIGN_SURFACES.md).

**Content safety (`src/lib/content-safety.ts`).** Every image route that takes a creator's free-text
prompt screens it through `assertSafePrompt()` **before charging credits or hitting the model**, and
spreads `IMAGE_SAFETY_SETTINGS` into the Gemini `config` (`BLOCK_ONLY_HIGH`, defense in depth). The
policy is deliberately PERMISSIVE — freedom of expression is the default, creators own their designs,
so nudity, seductive/edgy imagery, weapons, and action scenes all generate. Only three things are
blocked: **CSAM** (any sexual/nude context involving a minor — a hard block, never a policy toggle,
also blocked server-side by Google), **genuinely pornographic** prompts (explicit sex acts), and
**high-severity graphic gore** (a person being killed/mutilated — not action-hero imagery; the gore
patterns are tight, so "torture", "massacre", "bloodbath" and the like pass). **We do NOT police
copyright/IP** — named characters, brands, and celebrity likenesses are the creator's responsibility
(Terms put copyright on them via indemnification), so `✨ Enhance` / `🎲 Random` expand such prompts
faithfully rather than steering to an "original" equivalent. (If `/api/generate`'s underlying image
model declines a named character itself — RECITATION — that's the provider's limit, surfaced as a 422
"the image model wouldn't render this"; it is not us blocking it.) A blocked prompt returns HTTP 422
with a message and costs no credits. Wired into `/api/generate`, `/api/merge`, `/api/composite`,
`/api/tryon`, and `/api/enhance` (the prompt expander). `composite`/`tryon` carry only the
safetySettings since their inputs are an already-vetted design + a garment/selfie (no free-text
prompt). Separately, the Printful **print** policy (`pod-policy.ts`) still *warns* (not blocks) on
third-party IP at publish time — that reflects the fulfillment partner's real terms, not generation.

## Web graphics — generate → stage → assign to the site

The Generate sheet has **no mode tabs** — what it produces is derived from the **brand + collection
screen**: pick **🌐 Site assets** → it generates **web graphics** (`modality='graphics'` — hero /
banner / logo at a web ratio); pick a **product collection** → it generates **printable designs**
(`modality='design'`). (`GenerateModal` takes a `webMode={assetMode}` prop and sets
`modality = webMode ? 'graphics' : 'design'`; the old Design/Graphics/Video pill tabs were removed,
and Video generation lives in the brand Console, not here.) Every generation is **staged for review**
first — Apply change / Regenerate / Discard → **Use this** — before it lands on the canvas (generation
happens in the sheet; `commitDesign()` persists on approve).

**Tools** (square **ActionTiles** in a horizontal strip under the prompt — the pill chips were
removed, Joe 2026-08-18): **Upload**, **Transparent/Filled**, **Text** (design lettering, cut-out —
**design mode only**, not web assets), **Meme** (a frog icon — the IP-safe stand-in), **Idea** (🎲
`/api/idea`) and **Enhance** (✨). A collapsed *More options* section holds the **Effort slider** and
the aspect-ratio pickers. Staged review swaps in its own strip: **Mark** (the marker region-edit
tool), Apply, Regenerate, **Share**, Discard. Meme steers generation into the classic internet-meme
format via [`src/lib/meme.ts`](../../src/lib/meme.ts) — bold ALL-CAPS Impact caption (white + black
outline) over the described image, honoring named layouts (top/bottom, Drake, two-buttons,
this-vs-that…). A **graphics-mode** meme is full-bleed **filled**; a **product** meme uses
`buildMemePromptForProduct()` — the meme renders as a self-contained panel on a magenta margin and
keys **transparent**, so it prints as a tidy rectangle on the garment. Toggling Meme deselects Text
and presets the background (filled for graphics, transparent for products) but hides nothing; the
placeholder switches to teach the input format (image + caption). "Change it" in review re-edits the
staged meme (e.g. "change the bottom text to…"). Verified live: a "two buttons" prompt → a
correctly-formatted 1024×1024 meme.

A graphic on the canvas can then be **assigned to the site**: long-press it → *Set as website hero
/ collection cover / wordmark (logo) / app icon (mark) / favicon / social image (og)* (plus Share
and Delete). That posts to **`POST /api/creator/site-assets { catalogueId | storeSlug, slot, url }`**
(a direct DB write — the route accepts slots `hero | heroVideo | heroPoster | logo | mark | favicon
| cover | og | section:<key>`), which writes `stores.site_assets`, the logo/favicon columns, or the
catalogue's `cover_image_url`, then `revalidateStorefront(slug)`. Assigning a **logo or mark
re-derives the whole LogoKit** (mono variants, app tile, touch icon, favicon — `lib/logo-kit.ts`),
and a companion **`GET /api/creator/site-assets?storeSlug=…`** returns the current live assets so
the docks and Eve can show what's already on the site. (The canvas also has a `webslot` node kind
for these targets.) The
storefront's `getHeroMedia()` reads `site_assets` and **overrides** `content/placeholders.json`
(`live ?? placeholder`) — see [STOREFRONT_DATA_CONTRACT.md](../storefront/STOREFRONT_DATA_CONTRACT.md)
`/site-assets`. So an assigned hero replaces the brand-tinted placeholder with no re-layout — the
same contract as products.

## Products — Printful publish (`/api/publish`)

`POST /api/publish` (from `FinalizeSheet`) turns a composition into a **live Printful sync product**
and mirrors it into the local catalogue. Key facts grounded in `src/app/api/publish+api.ts`:

- **The print file is the upscaled RAW design PNG + saved position — never the AI composite or the
  mockup** (`upscaleForPrint(design.url)`, one file per placement). The composite is preview only.
- **Price floor enforced:** each variant must clear `minRetailCents(cost)` — cost comes from
  `getCatalogVariants(templateKey)`; below cost+margin is rejected. (Pricing single-source — see the
  `commerce-pricing-flow` notes.)
- **Mirrors into `products` + `variants`** under the composition's `storeId` and `catalogueId` (the
  collection/drop). `imageUrl` is the persisted mockup when one exists (`persistMockup` — off
  Printful's ~72h S3 link to Cloudinary), **else the raw design art as an instant fallback** so a
  publish that skipped the mockup step is never a blank card; a fire-and-forget task then renders
  the real Printful garment mockup (technique-aware) right after publish and swaps it in. This row
  is what feeds the Market tab + feed.
- **Refreshes the live site:** `void revalidateStorefront(store.slug)` so the newly-published product
  appears on the brand's storefront (the placeholder-replacement step in action).

The nested-variant shape these rows surface as (`/api/public/stores/:slug/products`) and the
`$0.00 = missing data` gotcha are in the
[data contract](../storefront/STOREFRONT_DATA_CONTRACT.md).

## Model shots — on-model photo gallery (`/api/creator/model-shots`)

**On-model by default (Joe, 2026-08-17):** every `/api/publish` auto-fires a background task that
resolves a real garment mockup, debits `model_shots`, and runs `generateModelShots(garment, 6)` —
**3 posed + 3 action/environment shots** — refunding on failure and skipping quietly on
insufficient credits (the publish is unaffected either way).

The manual route remains, at 3 shots: `POST /api/creator/model-shots { productId }` generates an
on-model photo gallery for an already-published product (Nano Banana,
`generateModelShots(imageUrl, 3)`). Ownership-checked + credit-gated (debits first, **refunds if
nothing comes back**). In both paths the URLs are written to **`products.modelShots`** — which the
public product shape exposes as `modelShots: [...]` for the storefront's on-model gallery. The
manual route requires the product to have an `imageUrl` (so: publish first, then shoot).

## Scene video — the "cool short" (`/api/creator/scene-video`, `/api/creator/model-videos`)

Two video paths — **scene video is two-step** (a faithful on-model still, then motion); **model
video is single-step** (the product image goes straight to Veo image-to-video) — and both append to
**`products.modelVideos`** (capped at 3 — see [data contract](../storefront/STOREFRONT_DATA_CONTRACT.md)):

### Scene video — creator-directed (`/api/creator/scene-video`)
The flagship "cool short". `generateProductSceneVideo()` (`src/lib/scene-video.ts`): Nano Banana
renders a photoreal still of a real person **wearing the exact garment** in a chosen `scene` (presets
in `SCENES`, or freeform), then a fal video model animates it (`src/lib/fal-video.ts`). Grounded in
the routes:

- **Creator picks the model tier** (`VIDEO_MODELS`, variable credit charge — see the
  `scene-video-engine` notes):

  | key | model | clip | credits |
  |---|---|---|---|
  | `wan` | Wan 2.5 | 5s | 60 (best value) |
  | `seedance` | Seedance 2.0 fast | 5s | 260 (premium, cinematic + audio) — **default** |
  | `veo3` | Veo 3 | 8s | 400 (top-tier realism + native audio) |

- **`target` routes the output:** `'website'` → appended to `products.modelVideos` (the site's
  on-model video wall); `'feed'` → `products.videoUrl` (the in-app feed, hidden for v1).
- **`aspectRatio`** `9:16` (default) or `16:9`. fal needs a reachable URL, so the still is hosted on
  Cloudinary first; the resulting clip is uploaded to Cloudinary too (no short-lived fal URLs leak).
- Rate-limited (4 / 10 min — video is the priciest call), ownership-checked, credit-gated with refund
  on failure (`debitCredits(user.id, videoModel.credits, …)`).

### Model video — one-tap angle (`/api/creator/model-videos`)
The simpler sibling: `POST /api/creator/model-videos { productId }` generates one on-model Veo clip
(`generateModelVideo` — the product image fed directly to Veo image-to-video, no intermediate still;
fixed `video_veo` cost), appending an angle to `products.modelVideos` (also capped at 3). Builds the
on-model video gallery without the creator directing a scene.

## The asset pipeline — placeholders → real

```
Design tab (src/app/design.tsx)
  generate artwork ──► /api/generate ──────────────► designs (Cloudinary)
  combine on blank ──► /api/compositions /composite ► composition (preview)
  finalize ─────────► /api/publish ─────────────────► Printful sync product
                                                       + products/variants row (imageUrl, storeId, catalogueId)
                                                       + revalidateStorefront(slug)
  model shots ──────► /api/creator/model-shots ─────► products.modelShots[]
  scene video ──────► /api/creator/scene-video ─────► products.modelVideos[]  (target 'website')
                                                       or products.videoUrl    (target 'feed')
  model video ──────► /api/creator/model-videos ────► products.modelVideos[]
        │
        ▼  (all writes land in the app's Postgres — the ONE catalogue)
platform-api  /api/public/stores/:slug/products  →  { imageUrl, modelShots, modelVideos, variants… }
        │
        ▼  (ISR revalidate:300 + on-demand revalidateStorefront on publish/delete)
Live brand site  — the brand's real products + media replace the forge's temporary placeholders
```

Every storefront-facing asset above is exposed through the **template-level** data layer (the public
product shape), so *every* generated brand site renders galleries and video the same way — never a
per-brand one-off (data-contract Rule #2). The creator's job in the Design tab is to fill that shape
with real assets; the contract carries them to the live site.

## Gotchas

- **Publish before shoot.** Model shots / videos require a product `imageUrl`, so the publish step
  has to run first.
- **`modelVideos` is capped at 3** and **replaces** once full (a 4th starts a fresh set) — true in
  both paths that write `modelVideos` (scene video with target `'website'`, and model video); the
  `'feed'` target writes `products.videoUrl`, where the cap doesn't apply.
- **Prices below cost+margin are rejected at publish** — fix the price, not the template, if a
  storefront shows `$0.00` (that means the variant's `retailPriceCents` is unset in the DB).
- **`revalidateStorefront` needs `VERCEL_TOKEN` on the app host (Cloud Run)** — without it, the live
  site only self-heals via ISR (~5 min), not on-demand.
