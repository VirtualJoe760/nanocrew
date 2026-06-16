# Nano Crew — API Reference

Two HTTP surfaces, one shared Supabase Postgres:

- **App backend** (`src/app/api/**+api.ts`) — Expo Router server routes, deployed on **Railway**
  (`backend-production-d7eb.up.railway.app`, persistent Node via `expo serve`). Creator/designer
  endpoints are **authed**: the client uses `apiFetch()` (`src/lib/api.ts`) to attach the Supabase
  bearer token, and the server verifies it locally with `getUserFromRequest` (`@/lib/auth`, local JWT
  verify) and scopes to the creator's stores (`src/lib/tenant.ts`). Several AI routes are
  **rate-limited** (`src/lib/rate-limit.ts`); the higher-cost AI ops are **credit-gated**
  (`src/lib/credits.ts`). Public-read store routes are unauthed.
- **platform-api** (`platform-api/app/api/**/route.ts`) — Next.js, deployed on **Vercel**
  (`nanocrew-api.vercel.app`). Public/CORS reads for the storefront websites, the POS checkout,
  signed webhooks, and the brand-site `/admin` creator routes (also bearer-authed via its own
  `getUserFromRequest`).

Common status codes: 400 bad request · 401/403 auth · **402 billing/credits**
(`{error:'insufficient_credits', needed, balance}`) · 404 not found · 409 conflict · 500 server ·
502 upstream (LLM/Printful/Stripe) · 503 not configured.

Legend: **bearer** = authed via `apiFetch` + `getUserFromRequest` · **RL** = rate-limited ·
**credits** = debit-before / refund-on-failure (`402` if short).

---

## 1. Auth & account

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/me` | bearer | Verify token; bootstrap the creator row + stores list. |
| DELETE | `/api/me` | bearer | Delete the account and its data. |
| GET | `/api/platform/admin` | bearer (admin email) | All stores + totals + creator count (`PLATFORM_ADMIN_EMAILS`). No in-app UI yet. |

## 2. Creator catalogue & shop

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/creator/products?storeSlug=` | bearer | A store's published products + video status. |
| DELETE | `/api/creator/products/:id` | bearer | Remove a product everywhere — our DB **+ Printful** — then `revalidateStorefront(slug)` to repaint the website. |
| POST | `/api/publish` | bearer, RL | Composition → live Printful sync product (idempotent). Enforces the price floor. |
| GET/POST | `/api/catalogues` | bearer | List / create collections (drops). |
| GET/PUT | `/api/canvas/:id` | bearer | Load / replace the designer canvas node tree. |
| POST | `/api/designs` | bearer | Persist an uploaded image as a design. |
| DELETE | `/api/designs/:id` | bearer | Delete a design. |
| POST | `/api/compositions` | bearer | Create a design-on-garment composition row. |
| GET/PATCH/DELETE | `/api/compositions/:id` | bearer | Read / update / delete a composition. |
| GET | `/api/creator/margins` | bearer | Per-product retail / Printful cost / margin% + average. |
| GET | `/api/blanks`, `/api/blank/:id/{variants,colors,placements,printareas}` | bearer | Printful catalogue data. |
| GET/PATCH/DELETE | `/api/creator/stores/:slug` | bearer | Read / edit / **delete** a brand. DELETE is owner-only and cascades the store → catalogues/designs/products/variants/orders/posts/revisions (external Printful/GitHub/Vercel cleaned out of band). |
| GET | `/api/creator/stats` | bearer | Per-store revenue, orders, 30-day views, OG + product images. |
| GET | `/api/creator/orders` | bearer | Recent orders across the creator's stores. |
| POST | `/api/creator/orders/:id/refund` | bearer | Refund an order. |
| POST/DELETE | `/api/creator/push-token` | bearer | Register / unregister an Expo push token. |
| POST | `/api/creator/upload` | bearer, RL | Upload an image asset. |

### Brand creation & site editing

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/store` | bearer | Persist a finished interview → logo + OG + provision site. **402** if no plan / over brand cap. |
| POST | `/api/creator/build-site` | bearer | Provision a website for a shop-only brand (409 if it already has one). |
| POST | `/api/creator/revise` | bearer | Request a site change on a `revision/<id>` branch (enqueues; never edits `main`). |
| GET | `/api/creator/revisions?storeSlug=` | bearer | Revision history + status + preview URLs. |
| POST | `/api/creator/revisions/:id/approve` | bearer | Merge a `ready` preview branch → production. |
| GET/POST | `/api/creator/posts` | bearer | Journal list / create. |
| PATCH/DELETE | `/api/creator/posts/:id` | bearer | Edit / delete a journal post. |
| GET | `/api/creator/stores/:slug/domain/search` | bearer | Search available custom domains. |
| POST | `/api/creator/stores/:slug/domain/buy` | bearer, **credits** | Buy a custom domain (variable credit charge, price→credits in `src/lib/domains.ts`). |
| POST | `/api/creator/stores/:slug/go-live` | bearer | Flip a brand to live. |

## 3. AI / designer

Core image ops are **authed + rate-limited but not credit-gated**; the expensive media ops debit
credits up front and refund on failure.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/idea?effort=` | bearer, RL | Random on-brand graphic prompt. |
| POST | `/api/generate` | bearer, RL | Nano Banana image gen (prompt + optional reference). |
| POST | `/api/merge` | bearer, RL | Blend two designs (Nano Banana). |
| POST | `/api/composite` | bearer, RL | Render a design on a garment photo (review). |
| POST | `/api/mockup` | bearer, RL | Real Printful mockups + persist positions. |
| POST | `/api/enhance` | bearer, RL | Expand a terse prompt into a rich one. |
| POST | `/api/tryon` | bearer, RL | Render a product on a selfie (selfie not stored). |
| POST | `/api/voice` | bearer, RL | Audio-first interview turn → reply speech + word timings; also `say` preview + `init`. |
| POST | `/api/interview` | bearer | Text-mode interview turn (fallback). |
| POST | `/api/transcribe` | bearer | Verbatim transcription of base64 m4a/mp4 (Gemini). Powers critique. |
| POST | `/api/video` | bearer, **credits** | Product video. `voiceover` cheap / `veo` = 400 credits (`CREDIT_COSTS.video_veo`). |
| POST | `/api/creator/model-shots` | bearer, **credits** | On-model image gallery (Nano Banana). Debits 20 (`model_shots`). |
| POST | `/api/creator/model-videos` | bearer, RL, **credits** | On-model Veo film for the website (appends, max 3 angles). Debits 400; rate-limited. |
| POST | `/api/creator/scene-video` | bearer, RL, **credits** | "Cool short" on fal.ai — pick `wan` (60) / `seedance` (160) / `veo3` (400); variable charge. |

## 4. Store & feed (app, public read)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/store/:slug` | — | In-app storefront (brand + products grouped by collection). |
| GET | `/api/store/:slug/products/:pslug` | — | Product detail page: images (main + on-model gallery), copy, purchasable variants (size/colour/price). |
| POST | `/api/store/:slug/checkout` | — | Proxies the cart to the platform-api POS (`/api/public/checkout`); same Stripe→Printful path. **503** if `PLATFORM_API_BASE` unset. |
| GET | `/api/market?q=` | — | Market tab data (trending + brands). |
| GET | `/api/feed` | bearer (optional) | Published products, newest first, with like/share counts; `likedByMe` filled when a token is present. |
| POST | `/api/feed/:id/like` | bearer | Toggle like. |
| POST | `/api/feed/:id/share` | — | Bump share count. |
| GET | `/api/public/stores/:slug/products` | — | (App-side mirror) headless catalog. |
| POST | `/api/public/beacon` | — | Anonymous pageview tick. |

## 5. Billing & credits

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/creator/credits` | bearer | Balance, op costs, ledger. Grants the signup bonus on first call. |
| GET | `/api/creator/subscription` | bearer | Plan + entitlements, brand count vs cap, tiers + credit packs. |
| POST | `/api/creator/billing/checkout` | bearer | Stripe Checkout URL (`kind: subscription | credit_pack`). |
| POST | `/api/creator/billing/portal` | bearer | Stripe billing-portal URL. |
| POST | `/api/creator/billing/iap-verify` | bearer | Apple IAP receipt verify → grant credits. **501** until `APPLE_IAP_SHARED_SECRET`. |
| GET/POST | `/api/creator/connect` | bearer | Read / start Stripe Connect onboarding for creator payouts. |

---

## 6. platform-api (Vercel, `nanocrew-api.vercel.app`)

### Public storefront reads (CORS)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/public/stores/:slug` | Brand facts for the live OG overlay. |
| GET | `/api/public/stores/:slug/products` | Headless catalog. **Returns products each with a NESTED `variants[]` array** (`{id, sku, color, size, retailPriceCents, inStock}`, size-sorted); products with zero variants are dropped. |
| GET | `/api/public/stores/:slug/collections` | Drops + counts. |
| GET | `/api/public/stores/:slug/videos` | Featured on-model film wall (Veo) for the homepage. |
| GET | `/api/public/stores/:slug/posts` | Published journal for the website. |
| GET | `/api/public/stores/:slug/posts/:postSlug` | One journal post. |
| POST | `/api/public/checkout` | **The POS.** Storefront cart → Stripe Checkout; validates store/variant ownership, in-stock, price, and routes via the brand's connected account. CORS preflight (`OPTIONS`). **503** if Stripe unconfigured. |
| POST | `/api/public/beacon` | Anonymous daily pageview tick. |

### Billing return pages

| Path | Purpose |
|---|---|
| `GET /billing/success` | Post-checkout landing (reads `?plan=` / `?credits=`); deep-links back to `nanocrew://account?billing=success`. |
| `GET /billing/cancel` | Cancelled-checkout landing. |

### Webhooks

| Method | Path | Verification | Purpose |
|---|---|---|---|
| POST | `/api/public/stripe-webhook` | Stripe signature (`constructEventAsync`, `WEBHOOK_SECRET`) | Commerce: paid order → submit to Printful. **400** bad signature. |
| POST | `/api/public/billing-webhook` | Stripe signature (separate `STRIPE_BILLING_WEBHOOK_SECRET`) | Subscriptions + credit-pack grants. **400** bad signature. |
| POST | `/api/public/printful-webhook` | **Opt-in token** | Fulfillment lifecycle → tracking. When `PRINTFUL_WEBHOOK_TOKEN` is set, the caller must present a matching `?token=` (constant-time compared) — **401** otherwise; when unset, falls back to the store-id check (**403**). |

### Brand-site `/admin` creator routes (bearer-authed)

These back the storefront's own `/admin` console (it calls platform-api `apiBase`, not the app).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/creator/stats` | bearer | Store stats for the admin dashboard. |
| GET | `/api/creator/orders` | bearer | Orders list. |
| POST | `/api/creator/orders/:id/refund` | bearer | Refund an order. |
| GET/POST | `/api/creator/posts` | bearer | Journal list / create. |
| PATCH/DELETE | `/api/creator/posts/:id` | bearer | Edit / delete a journal post. |
| POST | `/api/creator/revise` | bearer | Enqueue a site revision (`store_revisions`, status `building`, on a `revision/` branch — enqueue only). |
| GET | `/api/creator/revisions` | bearer | Revision history. |
| POST | `/api/creator/revisions/:id/approve` | bearer | Merge a ready preview branch via the GitHub API. |

---

### Conventions

- **Credits** are debited *before* an AI op and refunded on failure; `402` carries `{needed, balance}`.
- **Store launch** (`/api/store`) `402` carries `{error:'subscription_required'|'brand_limit', plan, maxBrands, brandCount}`.
- Public storefront reads set `Cache-Control`; `/api/publish` and the webhooks are idempotent.
- **`platform-api/db/schema.ts` is a COPY of `src/db/schema.ts`** — re-sync on every migration.
