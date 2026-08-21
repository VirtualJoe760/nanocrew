# Spec — Featured Products

**Status:** not built (2026-06-15). **Goal:** let a creator choose which products headline their
storefront home + their in-app store, instead of the homepage showing whatever sorts first. The
creator controls the "drop" the world sees.

## Why

Today the storefront home ("Latest Drop") and the in-app market show products by an arbitrary order
(recency or alphabetical). Creators have no control, and the result rarely matches the story they
want to tell. Featuring is the lever.

## Data model (schema change)

Add to `products` (sync `src/db/schema.ts` **and** `platform-api/db/schema.ts`, then migrate):

```ts
isFeatured: boolean('is_featured').notNull().default(false),
featuredOrder: integer('featured_order').notNull().default(0),  // creator-orderable; lower = first
```

Featured set = `isFeatured && isPublished`, ordered by `featuredOrder asc, createdAt desc`.

## platform-api (the contract)

- `GET /api/public/stores/:slug/products` adds `isFeatured` + `featuredOrder` to each product so any
  template can filter/sort locally. (Update `docs/STOREFRONT_DATA_CONTRACT.md` when you do.)
- Optional convenience: `?featured=1` to return only the featured set.

## App (creator control)

- **Console (`src/components/studio-composer.tsx`)**: a "Feature ★ / Featured ✓" toggle per product
  row (mirrors the existing delete action), calling a new `PATCH /api/creator/products/:id`
  `{ isFeatured }`. Reordering can come later (drag, or up/down).
- The mutation must call `revalidateStorefront(slug)` (fire-and-forget) so the live site reflects the
  change — same pattern as delete/publish.

## Templates (every brand site)

- The home "featured/latest drop" section reads the **featured set**; if it's empty, fall back to the
  newest N (so a brand that hasn't featured anything still looks complete).
- The in-app store (`brand-store.tsx`) leads with featured products (hero carousel already exists —
  point it at the featured set).

## Acceptance

- Toggling "Feature" in the app changes what shows on the storefront home within one rebuild.
- A brand with zero featured products still renders a sensible home (newest fallback).
- New brands generated from a template get this for free (no per-brand wiring).
