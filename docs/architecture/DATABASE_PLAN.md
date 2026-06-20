# Nano Crew Database Plan

The persistence layer is a **central multi-tenant Postgres** (Supabase) — every creator builds
their own store/website through the app, sells auto-fulfilled clothing, and is billed via Stripe.
Auth itself lives in **Supabase Auth** (`auth.users`); `creators.id` mirrors the Supabase user id.

> **Source of truth:** `src/db/schema.ts` (Drizzle). This doc tracks it — when the two disagree,
> the schema wins. Regenerate/apply with `npm run db:generate` / `npm run db:migrate`.
>
> **`platform-api/db/schema.ts` is a COPY of `src/db/schema.ts`.** It MUST be re-synced on
> EVERY migration — the public storefront API + webhooks read through that copy, and a drift
> between the two silently breaks the storefront. Treat "edit schema → migrate → copy to
> platform-api" as one atomic operation.
>
> **🔒 RLS rule — every new migration must enable RLS on the new table.** Row-Level Security is
> ENABLED (deny-all, no policies) on all public tables; the shipped Supabase anon key previously
> had full CRUD with RLS off. The app is unaffected — it connects as `postgres` (rolbypassrls) and
> the anon key is auth-only. Drizzle creates tables RLS-off, so each migration must add
> `ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;` for any new table.

---

## 1. Design principles (still in force)

- **Multi-tenant, store-scoped.** Every content/commerce row hangs off a `store_id`. The mobile
  app's `+api.ts` routes, the platform-api, and each codegen'd storefront all read the same DB
  filtered by store.
- **Money as integer cents** + a 3-char `currency` (default `USD`) — never floats.
- **`jsonb` for flexible shapes** — `brand_profile`, `design_system`, print `position` /
  `placements[]`, `shipping_address_json`, `model_shots` / `model_videos`, revision `screenshots`.
- **`printful_sync_*_id`** columns link our rows to Printful sync products/variants.
- **`onDelete: cascade`** down ownership chains (creator → store → catalogue/product → variant …);
  order rows are the exception — they preserve history (see §4).
- **`uuid` PKs**, indexes on FKs + status/filter columns.

---

## 2. Enums (`pgEnum`)

| Enum | Values |
| --- | --- |
| `store_status` | `draft` → `building` → `ready` → `live`, plus `suspended` |
| `composition_status` | `generating`, `draft`, `approved`, `published`, `failed` |
| `order_status` | `pending_payment`, `paid`, `submitted_to_printful`, `in_production`, `shipped`, `delivered`, `cancelled`, `refunded`, `on_hold`, `returned`, `failed`, `return_requested` (Printful webhooks drive `on_hold`/`returned`/`failed`; `return_requested` = a customer claim, distinct from `returned`) |
| `subscription_plan` | `free`, `starter`, `pro`, `advanced` |
| `subscription_status` | `active`, `trialing`, `past_due`, `canceled` |
| `revision_status` | `building` → `ready` → `approved`, plus `failed` |
| `payout_status` | `none`, `held`, `released`, `reversed`, `skipped` (the deferred-brand-payout state on `orders`; see §5 + [RETURNS_REFUNDS.md](../accounts/RETURNS_REFUNDS.md)) |
| `return_reason` | `defective`, `wrong_item`, `damaged`, `not_received` (POD = made-to-order, so no buyer's-remorse) |
| `return_request_status` | `requested` → `approved` / `declined`, plus `refunded` (terminal) |

Store lifecycle: `draft` (interview saved) → `building` (forge provisioning) → `ready` (deployed to
the `store-<slug>.vercel.app` preview, creator reviewing) → `live` (custom domain attached &
published). `suspended` = disabled.

---

## 3. Tenancy & identity

### `creators`
The app users (people building stores).
- `id` (uuid PK) — **= Supabase `auth.users.id`** (no separate auth tables; Supabase owns auth).
- `email` (text, **unique**, not null), `name`, `phone`, `image`, `createdAt`.
- `termsAcceptedAt`, `termsVersion` — legal acceptance recorded at account creation (the version of
  the Terms + Creator Agreement they accepted; see [AUTH_IDENTITY](../accounts/AUTH_IDENTITY.md)).
  `name`/`phone` come from the email-signup form's `user_metadata` (providers usually supply name only);
  `/api/me` upserts them + stamps acceptance server-side on first sign-in (migration 0020).

### `stores`
One per creator website/store (the thing the app generates).
- `id` (uuid PK), `creatorId` → `creators` (**cascade**) — the owner.
- `name`, `slug` (text, **unique** — the subdomain), `customDomain` (text, **unique**, nullable).
- `status` (`store_status`, default `draft`).
- `brandProfile` (jsonb) — Studio interview output: identity + character data (movie lines, etc.).
- `designSystem` (jsonb) — generated palette / typography / texture / motion language.
- `logoUrl`, `faviconUrl`, `ogImageUrl`, `tagline`, `descriptionMd`.
- `siteAssets` (jsonb) — creator-generated website graphics (hero media, section images) that override
  the template's `content/placeholders.json`. See STOREFRONT_DATA_CONTRACT `/site-assets`.
- `siteConfig` (jsonb) — mini-CMS overrides (copy / colors / fonts) edited in Studio, read LIVE by the
  template over its baked `brand.json` + `copy.json` (no rebuild). See `/site-config`.
- `repo` (text, nullable) — the brand's GitHub repo + Vercel project name. Provisioned brands default
  to `store-<slug>` (null); bespoke/imported brands (e.g. `stephen-lawyer`) set their real repo so the
  forge worker clones + previews the right one.
- `printfulStoreId` (text) — per-creator Printful sub-store.
- `deploymentUrl` (text) — the live/preview site URL.
- `isPublic` (bool, default `false`) — marketplace visibility; `sortOrder`.
- `createdAt`, `updatedAt`.
- Indexes: `creatorId`; `(isPublic, status)`.

### `store_collaborators`
Extra creators who may admin + design a store beyond its owner (`stores.creatorId`). The owner is
implicit and never listed here. Lets a client (e.g. Stephen Lawyer) and the agency share a store.
- `id`, `storeId` → `stores` (cascade), `creatorId` → `creators` (cascade).
- `role` (text, default `admin` — room to add `designer` etc.), `createdAt`.
- Unique index on `(storeId, creatorId)`.

---

## 4. Design generator (catalogue → design → composition → canvas)

### `catalogues` — **collections / drops**
A catalogue **IS** a collection/drop, used for storefront grouping.
- `id`, `storeId` → `stores` (cascade).
- `name`, `slug` (unique **per store** — composite unique index on `(storeId, slug)`).
- `season` (text — `spring` | `summer` | `fall` | `winter` | `drop` | null).
- **`coverImageUrl`** (text) — the collection's lookbook/cover image. **Already present** — the
  lookbook feature is data-model-ready (see `docs/COLLECTIONS_LOOKBOOK.md`).
- `isActive` (bool, default `true`), `sortOrder` (default 0), `createdAt`.
- Index on `storeId`.

### `designs`
A generated art asset within a catalogue.
- `id`, `storeId` (cascade), `catalogueId` → `catalogues` (cascade).
- `prompt`, `cloudinaryPublicId`, `url` (not null), `thumbUrl`, `createdBy` → `creators`, `createdAt`.

### `compositions`
A design placed on a Printful template → a printable/publishable product candidate.
- `id`, `storeId` (cascade), `catalogueId` (cascade), `designId` → `designs` (cascade).
- `templateKey` (Printful catalog product id), `placement` (default `front`).
- `position` (jsonb `PrintPosition`, null = Printful auto-fit).
- `placements` (jsonb array — multi-design front/back/sleeves; overrides single design/placement).
- `previewUrl`, `status` (`composition_status`, default `generating`), `printfulSyncProductId`,
  `errorMessage`, `createdAt`, `updatedAt`.

### `canvas_nodes`
Design-tab canvas layout state.
- `id`, `catalogueId` → `catalogues` (cascade).
- `kind` (`design` | `template` | `composition` | `group`), `refId`, `groupId`.
- `x`, `y`, `width`, `height`, `scale` (percent, default 100), `zIndex`.
- `colorImage`, `selectedColor` (template colourway), `updatedAt`.

---

## 5. Commerce (per store)

### `products`
- `id`, `storeId` → `stores` (cascade).
- `catalogueId` → `catalogues` (**`onDelete: set null`**) — which collection/drop it belongs to.
- `printfulSyncProductId` (text, **unique**).
- `slug` (unique **per store** — composite index on `(storeId, slug)`).
- `name`, `descriptionMd`.
- `category` (text — **free text**, not an enum; the full Printful catalog is broad).
- `imageUrl`, `videoUrl` (Veo-generated product video for the feed).
- `modelShots` (jsonb `string[]`, default `[]`) — Nano Banana on-model gallery.
- `modelVideos` (jsonb `string[]`, default `[]`) — Veo on-model video gallery (websites).
- `isPublished` (bool, default `false`), `shareCount` (int, default 0 — feed social proof).
- `createdAt`, `updatedAt`.
- Indexes: `storeId`; `(storeId, slug)` unique; `isPublished`.
- **No `sortOrder` column** (despite earlier framing) — products are not yet manually orderable.
- **No `isFeatured` column yet — PLANNED, not present.** "Featured products" needs this column
  added in a future migration (see `docs/FEATURED_PRODUCTS.md`). Document it as a planned change.

### `variants`
- `id`, `productId` → `products` (**cascade**).
- `printfulSyncVariantId` (text, **unique**), `sku` (not null, **unique** index).
- `color`, `size`.
- `retailPriceCents` (int, not null) — single source of price truth (cost+$5 floor; see pricing).
- `printfulCostCents` (int) — our Printful cost, captured at publish.
- `currency` (varchar(3), default `USD`), `inStock` (bool, default `true`), `imageUrl`.

### `orders`
- `id`, `storeId` → `stores` (cascade), `customerEmail` (not null).
- `stripeSessionId` (**unique**), `stripePaymentIntentId`, `printfulOrderId`.
- `status` (`order_status`, default `pending_payment`).
- `subtotalCents`, `shippingCents`, `taxCents`, `totalCents` (all int).
- `applicationFeeCents` (int, default 0) — the platform cut (Stripe Connect).
- `currency` (varchar(3), default `USD`).
- `shippingAddress` (jsonb, column `shipping_address_json`), `trackingUrl`, `trackingNumber`.
- **Return window + payout hold (migration `0024`):**
  - `shippedAt` (timestamp) — stamped in the `package_shipped` webhook.
  - `returnWindowEndsAt` (timestamp) — `shippedAt + RETURN_WINDOW_DAYS` (env, default 7); the claim
    deadline (= `payoutReleaseAt`).
  - `stripeChargeId` (text) — the charge id (`source_transaction` for the held transfer), captured
    at `checkout.session.completed` from the PaymentIntent's `latest_charge`.
  - `brandNetCents` (int, not null, default 0) — the deferred transfer amount (brand's net).
  - `connectedAccountId` (text) — the transfer destination, snapshotted at checkout.
  - `payoutStatus` (`payout_status`, not null, default `none`) — `none · held · released · reversed
    · skipped` (the brand-payout state machine; see [RETURNS_REFUNDS.md](../accounts/RETURNS_REFUNDS.md) +
    [BILLING_CREDITS.md](../accounts/BILLING_CREDITS.md)).
  - `payoutReleaseAt` (timestamp) — when the release job may transfer (= `returnWindowEndsAt`).
  - `payoutTransferId` (text) — the Stripe transfer id once released.
- `createdAt`, `updatedAt`. Indexes: `storeId`; `status`; **`(payoutStatus, payoutReleaseAt)`**
  (`orders_payout_release_idx` — the release-job scan).

### `order_items`
- `id`, `orderId` → `orders` (**cascade**).
- `variantId` → `variants` (**`onDelete: set null`**) — so deleting a variant/product does NOT
  delete order history.
- `quantity`, `unitPriceCents`.
- **`nameSnapshot`** (text, not null) + **`variantSnapshot`** (text, not null) — name/variant are
  snapshotted at purchase, so deleting a product later **preserves order history** intact.

### `return_requests` — customer return claims (migration `0024`)
A customer-opened defect/wrong/damaged/not-received claim against an order. Created by
`POST /api/public/returns`, resolved from the Studio returns inbox. See
[RETURNS_REFUNDS.md](../accounts/RETURNS_REFUNDS.md).
- `id` (uuid PK), `orderId` → `orders` (**cascade**).
- `storeId` → `stores` (**cascade**) — **denormalized** from the order so the creator inbox + RLS
  scope by store without a join.
- `customerEmail` (text, not null).
- `reason` (`return_reason` — `defective` | `wrong_item` | `damaged` | `not_received`).
- `itemsJson` (jsonb, nullable) — which order_items/quantities the claim covers (null = whole order).
- `photoUrls` (jsonb, nullable) — evidence; **required for `defective`/`damaged`** at the API layer.
- `note` (text, nullable) — the buyer's note.
- `status` (`return_request_status`, not null, default `requested`).
- `resolution` (text), `refundId` (text — Stripe refund id once refunded), `rmaCode` (text, usually
  unused — most POD claims need no physical ship-back).
- `createdAt`, `resolvedAt`. Indexes: `orderId`; `storeId`; `status`.
- **🔒 RLS enabled deny-all** (migration `0024`, per the RLS rule above) — the app reads it as
  `postgres`; the anon key cannot touch it.

---

## 6. Marketplace / feed engagement

### `product_likes`
Feed likes — one row per `(product, viewer)`; the like count is a count of these rows.
- `id`, `productId` → `products` (cascade), `userId` (uuid — Supabase auth user; a free account
  is enough), `createdAt`.
- Unique index on `(productId, userId)`; index on `productId`.

### `page_views`
Brand-site traffic beacon, daily granularity.
- `id`, `storeId` → `stores` (cascade), `day` (text `YYYY-MM-DD`), `views` (int, default 0).
- Unique index on `(storeId, day)`.

---

## 7. Blog / journal

### `store_posts`
DB-backed posts authored from the site `/admin` AND Studio. Living here (not in the repo) makes
publishing instant and free — no forge run, no redeploy. Templates fetch via the public API and
fall back to `content/blog/*.md`.
- `id`, `storeId` → `stores` (cascade), `slug` (unique per store).
- `title`, `excerpt`, `bodyMd` (default `''`), `coverImageUrl`.
- `isPublished` (bool, default `false`), `publishedAt`, `createdAt`, `updatedAt`.
- Indexes: `(storeId, slug)` unique; `(storeId, isPublished)`.

---

## 8. Site revisions (the visual editing loop / provisioning queue)

### `store_revisions`
A creator's requested change is applied on a **working branch** (never `main`), which Vercel
deploys as a preview. The creator reviews, then approves — only then does the branch merge to
`main` and go to production. This table is also the queue the forge worker drains.
- `id`, `storeId` → `stores` (cascade).
- `requestMd` (text, not null) — the change request as markdown.
- `screenshots` (jsonb) — annotated screenshot URLs the creator/Venus marked up.
- `status` (`revision_status`, default `building`).
- `branch` (text, not null), `previewUrl`, `errorMsg`, `createdAt`, `updatedAt`.
- Index on `(storeId, status)`.

---

## 9. Credits (metering AI spend)

Every creator has a credit balance; AI operations debit it (cost + markup). Top-ups (Stripe on
web, Apple IAP in-app) and subscription monthly grants credit it. The ledger is the audit trail;
balance is the running sum, cached on the account.

### `credit_accounts`
- `creatorId` (uuid **PK**) → `creators` (cascade).
- `balance` (int, default 0 — 1 credit ≈ $0.01 retail), `updatedAt`.

### `credit_ledger`
- `id`, `creatorId` → `creators` (cascade).
- `delta` (int — `+grant` / `−debit`).
- `reason` (text — `signup_bonus` | `video_voiceover` | `video_veo` | `topup` | …).
- `refId` (text — e.g. the product/composition id).
- `balanceAfter` (int, not null), `createdAt`.
- Index on `(creatorId, createdAt)`.

---

## 10. Creator billing

### `subscriptions`
Creator pays Nano Crew to run their store.
- `id`, `creatorId` → `creators` (cascade).
- `stripeCustomerId` (not null), `stripeSubscriptionId` (**unique**).
- `plan` (`subscription_plan`, default `free`), `status` (`subscription_status`, default `active`).
- `currentPeriodEnd`, `createdAt`, `updatedAt`.

> Plan tiers (Stripe products via `setup-stripe-plans.mjs`): free (browse/shop) · starter $10
> (app-only) · pro $49/$50 (website + domain) · advanced $149/$199 (better credit rate). Website
> is Pro+ gated. (Exact retail prices live in Stripe / the plan-tiers memory.)

### `connected_accounts`
Stripe Connect — routing customer payments to creators.
- `id`, `creatorId` → `creators` (cascade, **unique** — one per creator).
- `stripeAccountId` (not null, **unique**).
- `chargesEnabled`, `payoutsEnabled`, `detailsSubmitted` (all bool, default `false`), `createdAt`.

---

## 11. Infrastructure tables

### `rate_limits`
Fixed-window counter per bucket — deployment-agnostic (works on serverless), cheap (one upsert per
guarded request).
- `bucket` (text **PK** — `"<op>:<creatorId>"`), `count` (int, default 0), `windowStart`.

### `device_tokens`
Expo push tokens per creator device — the target for "your revision preview is ready" and future
order/sale alerts. One row per device token; a creator can have several (phone + tablet).
- `id`, `creatorId` → `creators` (cascade), `token` (text, **unique**).
- `platform` (text — `ios` | `android`), `createdAt`, `lastSeenAt`.
- Index on `creatorId`.

---

## 12. Relations (Drizzle `relations()`)

- `creators` → many `stores`, one `subscription`, one `connectedAccount`.
- `stores` → one `creator`; many `catalogues`, `products`, `orders`, `posts`.
- `catalogues` → one `store`; many `designs`, `compositions`, `canvasNodes`.
- `designs` → one `catalogue`; many `compositions`.
- `compositions` → one `catalogue`, one `design`.
- `canvasNodes` → one `catalogue`.
- `products` → one `store`; many `variants`, `likes`.
- `productLikes` → one `product`.
- `variants` → one `product`.
- `orders` → one `store`; many `items`.
- `orderItems` → one `order`, one `variant`.
- `storePosts` → one `store`.
- `storeRevisions` → one `store`.

`return_requests` carries FK references to `orders` + `stores` (both cascade) but has **no Drizzle
`relations()` helper** — the returns routes read it with explicit joins (`accessibleStoreIds()` scope),
so a relation wasn't needed.

Type exports (`$inferSelect`): `Creator`, `Store`, `Catalogue`, `DesignRow`, `Composition`,
`CanvasNodeRow`, `Product`, `Variant`, `Order`, `StorePost`, `StoreRevision`.

---

## 13. Migration checklist (do not skip)

1. Edit `src/db/schema.ts`.
2. `npm run db:generate` → review the SQL → `npm run db:migrate`.
3. **Copy `src/db/schema.ts` → `platform-api/db/schema.ts`** (they must stay byte-identical in
   table/column shape) and redeploy platform-api.
4. Update this doc.
