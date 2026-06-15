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
      "collection": "Summer 2026 | null",   // the catalogue name
      "collectionSlug": "summer-2026 | null",
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

### `POST /api/public/checkout`  `{ storeSlug, items: [{ variantId, quantity }] }` → `{ url }`

The shared **POS**: prices come from the DB (client cart untrusted), an order row is created
`pending_payment`, Stripe Checkout returns a URL, and the webhook flips it to `paid` and hands the
order to Printful. The in-app store proxies this via `/api/store/:slug/checkout`. A storefront's
"add to cart → checkout" MUST go through here — never its own Stripe — so variant IDs, pricing, and
fulfilment are single-source.

## How a template consumes the catalogue

Standard templates (`nanocrew-templates/templates/{minimal,bold,elegant,extravagant}`) fetch from
platform-api using `brand.json.apiBase` + the store slug, with `next: { revalidate: 300 }` (ISR).
The home, shop, product, and cart pages all read through this one data layer — so re-pointing the
data layer re-points the whole site (this is what made the stephenlawyer.clothing cutover one file).

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

Some brands run a **bespoke** site, not a Nanocrew template — `stephenlawyer.clothing` is the
original standalone app Nanocrew was prototyped from (its own Sanity CMS, its own Drizzle DB, its own
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

Going forward, the durable fix for new brands is **not** bespoke sites — it's generating them from
the templates, which already obey this contract.
