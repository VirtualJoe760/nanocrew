# Storefront Data Contract

**The single most important doc for anyone touching a brand website.** It defines how a brand's
catalogue flows from the app to the live storefront, the exact API shapes a template consumes, and
the rule that keeps every generated site in sync. Written 2026-06-15 after the
stephenlawyer.clothing cutover surfaced every way this can go wrong.

## The chain (one direction, one source of truth)

```
Creator manages catalogue in the APP (Studio Console: publish / delete / edit / feature)
   │
   ▼
Supabase Postgres  ── THE source of truth ──  stores · catalogues(collections) · products · variants
   │
   ▼
platform-api  (Vercel: nanocrew-api.vercel.app)  ── public, read-only, CORS ──  the CONTRACT
   │   GET /api/public/stores/:slug/products
   │   GET /api/public/stores/:slug/collections
   │   POST /api/public/checkout
   ▼
Storefront template  (per-brand Vercel site)  ── fetches at build/ISR ──  renders the brand site
   │
   ▼
Live brand website  (e.g. stephenlawyer.clothing)
```

**Rule #1 — the app's database is the only catalogue.** A storefront must never keep its own product
list (a local data file, its own CMS, its own DB). It reads the catalogue from platform-api at build
/ ISR time. If a site has its own catalogue it *will* drift (this is exactly what happened to
stephenlawyer.clothing — see "Cutover" below).

## platform-api public endpoints (the contract)

These are the only catalogue surface a storefront may use. Source: `platform-api/app/api/public/`.
Keep this section in lockstep with those routes.

### `GET /api/public/stores/:slug/products`

Returns **published products with NESTED variants** (not flat rows — the #1 gotcha):

```jsonc
{
  "products": [
    {
      "id": "uuid",
      "slug": "coast-sunset-crew-438876637",
      "name": "COAST SUNSET CREW",
      "descriptionMd": "string | null",
      "imageUrl": "https://res.cloudinary.com/.../coast-sunset-crew.jpg | null",
      "modelShots": ["url", ...],          // on-model gallery
      "modelVideos": ["url", ...],
      "category": "string | null",          // free text; templates infer (tee/hoodie/…) from the name
      "collection": { "slug": "summer-2026", "name": "Summer 2026" }, // NESTED, or null — NOT a flat collectionSlug
      "variants": [                          // ◄── prices/sizes/colours live HERE, nested
        { "id": "uuid", "sku": "5351847467", "color": "Black", "size": "S",
          "retailPriceCents": 7800, "inStock": true }
      ]
    }
  ]
}
```

Gotchas that have bitten us:
- **Variants are nested under `variants`.** There is no top-level `variantId` / `retailPriceCents`.
  Reading the flat shape silently yields `$0.00` prices and empty size/colour pickers.
- **`category` is free text or null.** Templates with fixed categories (tees/hoodies/hats/
  accessories) must infer from the product name.
- **A `$0.00` price means missing data in our DB** (variant `retailPriceCents` unset), not a mapping
  bug — fix the price in the app, not the template.

### `GET /api/public/stores/:slug/collections`

Collections (a.k.a. catalogues / drops). The `catalogues` table already carries `coverImageUrl`,
`season`, `sortOrder`, `isActive` — so collection covers + a lookbook are **data-model-ready**; what's
missing is template rendering + app UI (see `docs/COLLECTIONS_LOOKBOOK.md`).

### `GET /api/public/stores/:slug/site-assets`

Creator-generated **website graphics** (made in the Design tab), used to OVERRIDE the template's
baked `brand.json` / `content/placeholders.json`. `hero`/`sections`/`og` live on `stores.site_assets`
(jsonb); `logo` is the top-level `stores.logo_url` column (also set by brand creation). This is what
lets **every asset assigned in the Design tab connect to the live site with no rebuild**.

```jsonc
{
  "logo": "https://… | null",            // the brand logo (Design tab → "Set as logo"). The header
                                          // reads this LIVE via getSiteLogo() and prefers it over the
                                          // baked brand.json logoUrl — so a newly assigned logo
                                          // applies by default. (street is wordmark-only, no logo.)
  "hero": { "imageUrl": "https://… | null", "videoUrl": "https://… | null", "poster": "https://… | null" },
  "sections": { "<key>": "https://…" },  // reserved for section/banner graphics
  "og": "https://… | null"               // creator-assigned social-share image (the "Social image"
                                          // bounty). The template's opengraph-image.tsx serves this
                                          // when set, else a generated branded card — so every site
                                          // always has a real OG image.
}
```

The template's `getHeroMedia()` / `getSiteLogo()` merge this **per-field over the baked value**
(`live ?? baked`), so an asset set here replaces the placeholder/baked one with no re-layout — the
same override model as products. Fields are `null`/`{}` until the creator assigns one.

### `GET /api/public/stores/:slug/site-config`

The **mini-CMS** overrides — site **copy, colors, and fonts** a creator edits in Studio (the brand
console → ✦ Site Options). Stored on `stores.site_config` (jsonb). Read LIVE and layered over the
template's baked `brand.json` + `copy.json`; absent fields keep the baked value. **No forge run, no
rebuild** — an edit shows on the next page load.

**SEO reads this live too** (Batch 2, 2026-06-20): the template root `layout.tsx` uses
`generateMetadata()` + `getSiteCopy()` so `copy.story`/`copy.tagline` drive the `<title>`, meta
description, OG/Twitter, and the `Organization` JSON-LD (`organizationLd()` takes live
`{description, slogan, logo}`); the About page renders the live `storyBody`. So a rename / story /
tagline edit reaches SEO with no rebuild — previously these were baked from `brand.json` and went
stale (the "Alpha Master" meta-description bug). Static subpages (`/shop /about /contact /blog`) are
now self-canonical (were inheriting `canonical:'/'`).

```jsonc
{
  "copy":   { "heroHeadline": "…", "heroSubline": "…", "heroCta": "…", "storyKicker": "…", "story": "…", "tagline": "…" },
  "colors": { "background": "#…", "text": "#…", "primary": "#…", "accent": "#…" },
  "fonts":  { "display": "<preset>", "body": "<preset>" }   // preset keys → font stacks in lib/site-config.ts
}
```

Template wiring (`lib/site-config.ts`, all 4 templates): `getBrandColors()` feeds `layout.tsx`'s CSS
vars, `getSiteCopy()` drives the hero + Our Story copy, `getFontVars()` resolves the font presets to
CSS stacks + a Google Fonts `<link>`. The write path is **direct** (`POST /api/creator/site-config`,
access-checked), distinct from the Venus→forge revision flow used for open-ended redesigns.

The Customize editor (`src/components/site-editor.tsx`) picks colors with a **true hex picker** —
continuous Hue/Saturation/Brightness gradient sliders (react-native-svg) that yield any hex, not a
fixed set of preset swatches.

`GET /api/public/stores/:slug` (the brand-facts read) now also returns **`isPublic` + `status`**, so
a consumer can tell whether a brand is listed/live without a separate call.

### `POST /api/public/checkout`  `{ storeSlug, items: [{ variantId, quantity }] }` → `{ url }`

The shared **POS**: prices come from the DB (client cart untrusted), an order row is created
`pending_payment`, Stripe Checkout returns a URL, and the webhook flips it to `paid` and hands the
order to Printful. The in-app store proxies this via `/api/store/:slug/checkout`. A storefront's
"add to cart → checkout" MUST go through here — never its own Stripe — so variant IDs, pricing, and
fulfilment are single-source.

## The nanocrew.app web storefronts (`./nanocrew-site`)

Every **listed** brand also gets a web storefront at **`nanocrew.app/b/<slug>`** (`app/b/[brand]`),
reusing the shared POS — so a brand with no dedicated website still sells on the web (and in-app)
the moment it's published. The **Nano Crew company store** lives at **`nanocrew.app/store`** (HQ).
The cart is **single-brand** (`CartLine.storeSlug`); checkout (`app/api/checkout/route.ts`) forwards
that slug to `/api/public/checkout`, so the same data contract and POS apply. These pages read the
public store/products/collections endpoints exactly like the templates — Rule #1 still holds.

## How a template consumes the catalogue

Standard templates (`nanocrew-templates/templates/{minimal,bold,elegant,extravagant,street}`) fetch from
platform-api using `brand.json.apiBase` + the store slug, with `next: { revalidate: 300 }` (ISR).
The home, shop, product, and cart pages all read through this one data layer — so re-pointing the
data layer re-points the whole site (this is what made the stephenlawyer.clothing cutover one file).

**Brand sites are env-less — the connection config lives in `brand.json`, not Vercel env.** Template
source has *zero* `process.env` reads; `apiBase`, the Supabase URL/anon key, and the fee terms are
all baked into `brand.json` at provision and committed to the repo, so a new brand connects to the
platform with no per-site env setup. Crucially, **no brand repo ever holds a Stripe or Printful
secret** — checkout proxies to the central POS (`/api/public/checkout`). The values in `brand.json`
are populated from the **app server's** env (`PLATFORM_API_BASE`, `EXPO_PUBLIC_SUPABASE_*`,
`PROCESSING_FEE_*`) at provision time — so if those are missing on Railway, new brands ship with an
empty `apiBase` and fall back to placeholder products. (Bespoke cutover sites like
`stephenlawyer.clothing` are the exception: they read `process.env.NANOCREW_API` and so *do* need
that one var set on their own Vercel project — see "Cutover" below.) The provisioning + config
mechanics live in [STOREFRONT_ENGINE.md](./STOREFRONT_ENGINE.md) ("Brand sites are env-less").

**Rule #2 — storefront features are wired at the TEMPLATE level.** Catalogue, featured products,
collections/lookbook, cart, and checkout must be built into the templates so that *every brand site
generated from them ships the feature correctly*. Never one-off a feature into a single brand's repo
— that's how sites diverge and how we end up re-fixing the same thing per brand.

## Keeping the live site in sync

The app's DB changes constantly; the storefront is statically built. Two mechanisms keep them
matched:

1. **ISR** — pages set `revalidate: 300`, so a site self-heals within ~5 min of a catalogue change
   *if the page is requested*. Not instant, and not guaranteed if traffic is low.
2. **On-demand rebuild** — `src/lib/storefront-revalidate.ts` `revalidateStorefront(slug)` triggers a
   fresh Vercel build of the brand's project (tries project names `<slug>` and `store-<slug>`). It's
   wired fire-and-forget into the product **DELETE** and **publish** endpoints, so deleting/publishing
   a product rebuilds that brand's site. Requires `VERCEL_TOKEN` on the app host (set on Railway).

If a site shows stale products after a change: it either (a) hasn't rebuilt yet (force via
`revalidateStorefront`), or (b) isn't reading platform-api at all (a custom/un-cutover site).

## Custom sites & the cutover (the stephenlawyer.clothing case)

Some brands run a **bespoke** site, not a Nano Crew template — `stephenlawyer.clothing` is the
original standalone app Nano Crew was prototyped from (its own Sanity CMS, its own Drizzle DB, its own
NextAuth/cart/checkout). Such a site **does not read our catalogue**, so it drifts permanently
(it still showed 28 products incl. deleted camo while our DB had 21).

**Cutover pattern** (done for stephenlawyer.clothing on branch `nanocrew-cutover`, repo
`VirtualJoe760/stephen-lawyer`):
1. Find the one data-layer file the pages call (here `src/lib/db-products.ts`, exporting
   `getPublishedSummaries/Product`, `getStoreSummaries/Product`, `hasPublishedProducts`).
2. Rewrite it to `fetch` platform-api and map the response to the site's existing product types —
   **keeping the same function signatures**, so shop + product pages re-point with no other edits.
3. Switch any page still on mock/placeholder data (the home "Latest Drop" used `mock-products`) to
   the now-API-backed data layer.
4. Deploy a **preview** (never straight to production), eyeball it, then merge.
5. Checkout is a separate phase: re-point the bespoke cart/checkout to `POST /api/public/checkout`.

**Status — deployed.** The cutover shipped: the `nanocrew-migration` branch merged → live. The
lookbook is now **app-driven** (reads collections + products; no more hardcoded Unsplash), and
on-model imagery was generated for all **21 products** via `scripts/gen-stephen-imagery.mjs`.

Going forward, the durable fix for new brands is **not** bespoke sites — it's generating them from
the templates, which already obey this contract.
