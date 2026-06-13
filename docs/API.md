# Nanocrew — API Reference

Two surfaces:
- **App routes** (`src/app/api/**+api.ts`) — run on the Expo/Metro app server; creator endpoints
  are authed with a Supabase bearer token (`Authorization: Bearer <token>`, via `getUserFromRequest`).
- **platform-api** (`platform-api/app/api/**/route.ts`) — deployed at `nanocrew-api.vercel.app`;
  public/CORS reads for storefront sites + signed webhooks.

Common status codes: 400 bad request · 401/403 auth · **402 billing/credits** · 404 not found ·
409 conflict · 500 server · 502 upstream (LLM/Printful/Stripe) · 503 not configured.

## A. Auth & creator account
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/me` | bearer | Verify token; bootstrap creator + stores list. |
| GET | `/api/creator/stats` | bearer | Per-store revenue, orders, 30-day views, OG + product images. |
| GET | `/api/creator/orders` | bearer | Recent orders across the creator's stores. |
| GET | `/api/creator/subscription` | bearer | Plan + entitlements, brand count vs cap, tiers + credit packs. |
| GET | `/api/creator/credits` | bearer | Balance, op costs, ledger. Grants signup bonus on first call. |
| GET | `/api/creator/margins` | bearer | Per-product retail / Printful cost / margin% + avg. |
| GET | `/api/creator/products?storeSlug=` | bearer | A store's published products + video status. |
| POST/DELETE | `/api/creator/push-token` | bearer | Register / unregister an Expo push token. |

## B. Brand creation & site editing
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/voice` | bearer | Audio-first interview turn → reply speech + word timings; also voice preview (`say`) and `init`. |
| POST | `/api/interview` | bearer | Text-mode interview turn (fallback). |
| POST | `/api/transcribe` | bearer | Verbatim transcription of base64 m4a/mp4 (Gemini). Powers the critique flow. |
| POST | `/api/store` | bearer | Persist a finished interview → logo + OG + provision site. **402** if no plan / over brand cap. |
| POST | `/api/creator/build-site` | bearer | Provision a website for an existing shop-only brand (409 if it already has one). |
| POST | `/api/creator/revise` | bearer | Request a site change on a working branch (`{storeSlug, requestMd, screenshots?}`). |
| GET | `/api/creator/revisions?storeSlug=` | bearer | Revision history + status + preview URLs. |
| POST | `/api/creator/revisions/:id/approve` | bearer | Merge a `ready` preview branch → production. |
| GET/POST/PATCH/DELETE | `/api/creator/posts[/:id]` | bearer | Journal CRUD (publishing is instant, no redeploy). |

## C. Designer pipeline (currently unauthed — see Remaining)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/idea?effort=` | Random on-brand graphic prompt. |
| POST | `/api/generate` | Nano Banana image gen (prompt + optional reference). |
| POST | `/api/enhance` | Expand a terse prompt into a rich one. |
| POST/DELETE | `/api/designs[/:id]` | Persist an uploaded image / delete a design. |
| GET/POST/PATCH/DELETE | `/api/compositions[/:id]` | Design-on-garment composition rows. |
| POST | `/api/composite` | Render a design on a garment photo (review). |
| POST | `/api/mockup` | Real Printful mockups + persist positions. |
| POST | `/api/publish` | Composition → live Printful sync product (idempotent). |
| GET | `/api/blanks`, `/api/blank/:id/{variants,colors,placements,printareas}` | Printful catalogue data. |
| GET/POST | `/api/catalogues` | List / create collections (drops). |
| GET/PUT | `/api/canvas/:id` | Load / replace the designer canvas node tree. |
| POST | `/api/merge` | Blend two designs (Nano Banana). |

## D. Feed & social
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/feed` | optional | Published products, newest first, with like/share counts + `likedByMe`. |
| POST | `/api/feed/:id/like` | bearer | Toggle like. |
| POST | `/api/feed/:id/share` | — | Bump share count. |
| POST | `/api/tryon` | — | Render the product on a selfie (selfie not stored). |
| POST | `/api/video` | bearer | Generate a product video (`voiceover` cheap / `veo` premium). Debits credits; refunds on failure; **402** if short. |
| POST | `/api/creator/model-shots` | bearer | On-model image gallery (Nano Banana). Debits 20; refunds on failure; **402** if short. |
| POST | `/api/creator/model-videos` | bearer | On-model Veo film for the website (appends, max 3 angles). Debits 400; rate-limited (4 / 10 min); refunds on failure; **402** / **429**. |

## E. Shop & storefront (read)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/market?q=` | Market tab data (trending + brands). |
| GET | `/api/store/:slug` | In-app storefront (brand + products grouped by collection). |
| GET | `/api/public/stores/:slug` | Brand facts for the live OG overlay. |
| GET | `/api/public/stores/:slug/products` | Headless catalog for the website (incl. `modelShots`, `modelVideos`). |
| GET | `/api/public/stores/:slug/videos` | Featured on-model film wall (Veo) for the website homepage. |
| GET | `/api/public/stores/:slug/collections` | Drops + counts. |
| GET | `/api/public/stores/:slug/posts[/:postSlug]` | Published journal for the website. |

## F. Billing & webhooks
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/creator/billing/checkout` | bearer | Stripe Checkout URL (`kind: subscription | credit_pack`). |
| POST | `/api/creator/billing/iap-verify` | bearer | Apple IAP receipt verify → grant credits. **501** until `APPLE_IAP_SHARED_SECRET` set. |
| POST | `/api/public/checkout` | CORS | Storefront cart → Stripe Checkout (validates inventory/price). |
| POST | `/api/public/stripe-webhook` | sig | Commerce: paid order → submit to Printful. |
| POST | `/api/public/billing-webhook` | sig | Subscriptions + credit-pack grants (separate secret). |
| POST | `/api/public/printful-webhook` | store-id | Fulfillment lifecycle → tracking. |
| POST | `/api/public/beacon` | CORS | Anonymous daily pageview tick. |

## G. Admin
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/platform/admin` | admin email | All stores + totals + creator count (`PLATFORM_ADMIN_EMAILS`). No in-app UI yet. |

### Conventions
- **Credits** are debited *before* an AI op and refunded on failure; a `402` carries `{needed, balance}`.
- **Store launch** (`/api/store`) `402` carries `{error: 'subscription_required'|'brand_limit', plan, maxBrands, brandCount}`.
- Public read routes set `Cache-Control` (120–300s). `/api/publish` and webhooks are idempotent.
