# Spec — Collections & Lookbook

**Status:** partially built (2026-08-20) — covers, grouped rendering, and the Market rail exist; the
cover-tile `/lookbook` route and collection-management UI don't. **Goal:** every brand groups its products
into **collections** (drops), each with a **cover image**, browsable as a **lookbook** — both on the
brand website and in the in-app marketplace. Clicking a cover opens that collection's products.

The screenshot that prompted this: stephenlawyer.clothing's "SUMMER 26 / HAZARD" and
"WINTER 25 / SPITFIRE" cover tiles — clickable editorial covers per collection.

## What already exists

- A **collection IS a `catalogues` row** (`src/db/schema.ts`). It already has:
  `name`, `slug`, `season`, **`coverImageUrl`**, `isActive`, `sortOrder`. So covers are
  data-model-ready — no schema change needed for the basics.
- Products link to a collection via `products.catalogueId`.
- `platform-api` already exposes `GET /api/public/stores/:slug/collections`.
- **Setting a collection cover** — the Design tab assigns a generated graphic via
  `POST /api/creator/site-assets` slot `'cover'` → `catalogues.cover_image_url`, then revalidates
  the site.
- **Templates consume collections** — the shared data layer has `getCollections()` +
  `getProductsByCollection()` (shop grouped by drop), and every standard template ships an
  editorial **Lookbook block** (a static image essay with `data-nano-image` slots).
- **In-app surfacing** — the Market feed ships a `collections` rail (live drops with cover art),
  and the in-app brand store groups products by collection with a cover (falling back to the first
  product image).

So the remaining gap: templates group the shop by collection and ship the editorial Lookbook block,
but there is still no **`/lookbook` page of collection COVER tiles** linking into each drop — and
the app gives creators no way to create/rename/reorder collections or assign products to them.

## What to build

### Templates (every brand site — the durable fix)
- **`/lookbook`** — a grid of collection **cover tiles** (`coverImageUrl` + `name` + `season`),
  ordered by `sortOrder`. Each links to that collection.
- **Collection page** (`/lookbook/:slug` or `/shop/:collectionSlug`) — the products in that
  collection (reuse the shop grid, filtered to `collectionSlug`).
- Home can feature 1–2 collection covers (like the screenshot) pulling from the lookbook.

### In-app marketplace + brand store
- The Market rail and brand-store grouping already exist (above). What remains: tapping a cover
  opens a **dedicated collection browse** (the in-app product grid already exists — filter by
  collection).
- This makes "browse the brand by drop" consistent between the app and the website.

### App (creator control, Console)
- Create/rename/reorder collections; assign products to a collection (some of this exists in the
  designer/catalogue flow — wire the ordering; the cover is already settable via the Design tab).
- Any change calls `revalidateStorefront(slug)` so the live lookbook updates.

## Contract notes
- When the public products/collections endpoints gain fields (e.g. a richer collection payload with
  its product previews), update `docs/STOREFRONT_DATA_CONTRACT.md`.
- Cover images follow the same hosting as product images (Cloudinary).

## Acceptance
- Every generated brand site has a working `/lookbook` with cover tiles → collection → products.
- A creator can set a collection cover in the app and see it on the site within one rebuild.
- The in-app market lets a shopper browse a brand by collection, matching the website.
