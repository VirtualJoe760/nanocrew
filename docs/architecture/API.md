# Nano Crew — API Reference

Two HTTP surfaces, one shared Supabase Postgres:

- **App backend** (`src/app/api/**+api.ts`) — Expo Router server routes, deployed on **Google Cloud Run**
  (`api.nanocrew.app`, persistent Node via `expo serve`). Creator/designer
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
| GET | `/api/me` | bearer | Verify token; bootstrap the creator row + stores list. A store with no `ogImageUrl` but a logo gets one computed at read time (`buildOgImageUrl` — deterministic Cloudinary URL, no write), so brand banners are always generated, never hand-uploaded. |
| DELETE | `/api/me` | bearer | Delete the account and its data. |
| GET | `/api/platform/admin` | bearer (admin email) | All stores + totals + creator count (`PLATFORM_ADMIN_EMAILS`). No in-app UI yet. |

## 2. Creator catalogue & shop

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/creator/products?storeSlug=` | bearer | A store's published products + video status. |
| DELETE | `/api/creator/products/:id` | bearer | Remove a product everywhere — our DB **+ Printful** — then `revalidateStorefront(slug)` to repaint the website. |
| POST | `/api/publish` | bearer, RL | Composition → live Printful sync product (idempotent). Enforces the price floor. **On-model by default (2026-08-17):** after publish it fire-and-forgets `generateModelShots` (debits `model_shots`, refunds on failure, skips quietly when credits are short) and repaints the storefront when shots land. |
| GET/POST | `/api/catalogues` | bearer | List / create collections (drops). Store-scoped via `?store=<slug>` / body `storeSlug`; the slug-less fallback resolves only for a single-brand creator — several brands is a **409**, never a guess (2026-08-20, BUG_AUDIT #1). |
| GET/PUT | `/api/canvas/:id` | bearer | Load / replace the designer canvas node tree. |
| POST | `/api/designs` | bearer | Persist an uploaded image as a design. |
| DELETE | `/api/designs/:id` | bearer | Delete a design. |
| POST | `/api/compositions` | bearer | Create a design-on-garment composition row. Technique adaptation (2026-08-20): a KNITWEAR **or EMBROIDERY** blank regenerates the primary design as fabrication-friendly art (`lib/adapt.ts` → new `designs` row with `technique` set) and returns `{adaptedDesign, technique}` — skipped when the design was already generated technique-ready (`designs.technique` matches). |
| PATCH | `/api/creator/products/:id` | bearer | Hide/show a product (`{isPublished}`) — it leaves the Market, feed and storefront but keeps its Printful sync product, variants and order history. Backs Market → My stores. |
| GET | `/api/creator/site-assets?storeSlug=` | bearer | The FULL live web-asset inventory ({hero, heroVideo, og (override ?? generated OG card), logo, favicon, logoKit:{wordmark,mark,appTile,favicon}, sections}) — read by the Design tab's Site-assets dock and Eve's asset flow; pre-kit brands derive the kit read-time from logo_url. POST slots: hero/heroVideo/heroPoster/logo/mark/favicon/cover/og/section:* — `logo`/`mark` re-derive the LogoKit + favicon_url; `favicon` overrides directly (a later mark assignment re-derives over it). |
| — | `/api/generate` `marks` param | bearer | Optional marker annotations (normalized polylines) with a reference image: baked as red strokes into the reference (`lib/annotate.ts`, pure-JS) + a marked-region rule appended — the model edits ONLY the circled region and erases the marks. |
| POST | `/api/creator/color-mockups` | bearer | Per-COLOUR Printful mockup shots for the pricing page — one generator task, one variant per colourway, preferring the product's photographed on-model style (`Men's`/`Women's`) over flat. Free (Printful generator, not paid AI). |
| GET/PATCH/DELETE | `/api/compositions/:id` | bearer | Read / update / delete a composition. PATCH also accepts `placements[]` — the PlacementEditor autosaves (debounced) as the creator drags, server-clamped and design-ownership-scoped, so publish never falls back to the default placement. |
| GET | `/api/creator/margins` | bearer | Per-product retail / Printful cost / margin% + average. |
| GET | `/api/blanks`, `/api/blank/:id/{variants,colors,placements,printareas,template}` | bearer | Printful catalogue data (`template` = the flat mockup image + REAL print-area fractions, so previews blend onto the actual print zone). |
| GET/PATCH/DELETE | `/api/creator/stores/:slug` | bearer | Read / edit / **delete** a brand. DELETE is owner-only and cascades the store → catalogues/designs/products/variants/orders/posts/revisions (external Printful/GitHub/Vercel cleaned out of band). |
| GET | `/api/creator/stats` | bearer | Per-store revenue, orders, 30-day views, product images, and `bannerUrl` — the brand banner (site hero → OG card → read-time `buildOgImageUrl` for any logo'd brand), never a product photo. |
| GET | `/api/creator/orders` | bearer | Recent orders across the creator's stores. |
| POST | `/api/creator/orders/:id/refund` | bearer | Refund an order (`refundOrder`, branches on `payoutStatus` — see [RETURNS_REFUNDS.md](../accounts/RETURNS_REFUNDS.md)). |
| GET | `/api/creator/returns` | bearer | The Studio **returns inbox** — every return claim across the creator's stores (`accessibleStoreIds`, owner + collaborators), newest first, joined with a small order summary. |
| POST | `/api/creator/returns/:id/approve` | bearer | Approve a claim → the **shared** refund path (`refundOrder`); marks the claim `refunded` + records the `refundId`. Idempotent. Best-effort approved/refund email via `/api/internal/notify`. |
| POST | `/api/creator/returns/:id/decline` | bearer | Decline a claim → claim `declined`, order reverts to `shipped` (no money moves). Best-effort decline email via `/api/internal/notify`. |
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
| POST | `/api/creator/revisions/:id/decline` | bearer | Reject the preview — `declineRevision()` discards the working branch and marks the revision `declined`; production is never touched. Only a `building`/`ready` revision can be declined. |
| GET/POST | `/api/creator/site-config` | bearer | The **mini-CMS** write/read path: edit the site's copy / colors / fonts from Studio — a direct DB write to `stores.site_config` (NOT the forge), read live by `/api/public/stores/:slug/site-config`. No rebuild. |
| GET/POST | `/api/creator/posts` | bearer | Journal list / create. |
| PATCH/DELETE | `/api/creator/posts/:id` | bearer | Edit / delete a journal post. |
| GET | `/api/creator/stores/:slug/domain/search` | bearer | Search available custom domains. |
| POST | `/api/creator/stores/:slug/domain/buy` | bearer, **credits** | Buy a custom domain (variable credit charge, price→credits in `src/lib/domains.ts`). |
| POST | `/api/creator/stores/:slug/publish` | bearer | **App-only Publish** `{ listed? }` — open (or close) the brand's shop in the ecosystem: sets `isPublic + status='live'` (lists in the in-app Market + `nanocrew.app/b/<slug>`). Needs an active plan + ≥1 published product **+ a payout-ready Connect account** (`409 payouts_required` until `charges_enabled` — Joe's rule, 2026-08-16: KYC before selling; checkout enforces it independently too). `409` if still building / `no_published_products`; `402 subscription_required`. |
| GET/POST/DELETE | `/api/creator/stores/:slug/collaborators` | bearer | **Owner-only** collaborator management. GET → members + pending invites; POST `{ email }` → consent-based **invite** (`store_invites` row + branded email via `internal/notify collab_invite`; the invitee does NOT need an account yet — a prior pending invite for the same email is superseded); DELETE `{ collaboratorId | inviteId }` removes / revokes. `409` already-owner/already-collaborator. Collaborators design + manage via `tenant.ts`; only the owner administers membership; go-live/publish/domain stay owner-only. |
| GET/POST | `/api/creator/invites` | bearer | The signed-in creator's pending invites (matched on email) with brand + inviter; POST `{ inviteId \| token, action: 'accept' \| 'decline' }` — accept inserts `store_collaborators`; the invite's email must match the session (`403 email_mismatch`), `410` expired. Token path serves the email deep link (`nanocrew://account?invite=<token>`). |
| POST | `/api/eve/route` | bearer | **The voice intent router.** Each committed user turn is classified (`create-brand` · `edit-site` · `new-design` · `site-asset` · `write-post` · `digest` · `done` · `none`) so her surface can transition mid-conversation. Precision-biased and fail-open — every failure path returns `none`, never an error. Three one-shot exceptions relax that bias for the turn straight after she asks a question: `awaitingDesignIdea`, `awaitingAssetIdea`, and **`awaitingSiteChoice`** (2026-08-19) — the last makes a bare brand name after "which site?" classify as `edit-site` with that slug instead of dropping to `none`, even mis-heard ("Sardene Club" → `sardine-club`). |
| POST | `/api/creator/stores/:slug/go-live` | bearer | Flip a brand to live with its own custom domain (the separate Pro website upgrade, layered on top of app-only publish). |

## 3. AI / designer

Image generation/edit ops debit **8 credits** each (debit-before, refund-on-failure, `402` when
short); composite/mockup/enhance/tryon/idea are free but rate-limited. The expensive media ops
debit larger amounts the same way.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/idea?effort=` | bearer, RL | Random on-brand graphic prompt. |
| POST | `/api/generate` | bearer, RL, **credits** | Nano Banana image gen (prompt + optional reference). Debits 8 (`design_generate` / `logo_generate`). Optional `templateKey` (the destination Printful blank, 2026-08-20): constrained techniques (EMBROIDERY / KNITWEAR — `lib/technique.ts`) condition the prompt so the art is born producible; the design row and response carry `technique`. |
| POST | `/api/merge` | bearer, RL, **credits** | Blend two designs (Nano Banana). Debits 8 (`merge`). |
| POST | `/api/edit` | bearer, RL, **credits** | Semantic design editor — one existing design + an instruction shaped by an edit mode (`inpaint` / `text` / `remix` / `custom`); stores the result as a **NEW** design row (non-destructive). Debits 8 (`design_edit`). |
| POST | `/api/extract-brand` | bearer | Turn the accumulated Gemini Live transcript → structured `BrandResult` with a text model (native-audio Live can't reliably emit the save-brand tool call). Same brain as the interview (`lib/interview.ts`). |
| POST | `/api/composite` | bearer, RL | Render a design on a garment photo (review). |
| POST | `/api/mockup` | bearer, RL | Real Printful mockups + persist positions. |
| POST | `/api/enhance` | bearer, RL | Expand a terse prompt into a rich one. Optional `technique` (2026-08-20): EMBROIDERY / KNITWEAR steer the enhancement away from gradients and photo detail the fabrication can't produce. |
| POST | `/api/tryon` | bearer, RL | Render a product on a selfie (selfie not stored). |
| POST | `/api/voice-live-token` | bearer | Mint a short-lived Gemini Live ephemeral token; the app connects to Gemini Live directly (the realtime Eve interview — `lib/live-voice.ts`). |
| POST | `/api/say` | bearer, RL | One-shot TTS in Eve's Gemini voice (Aoede) → base64 WAV. Used for the post-build launch line. (The old turn-based `/api/voice` + `/api/interview` ElevenLabs routes were removed.) |
| POST | `/api/transcribe` | bearer | Verbatim transcription of base64 m4a/mp4 (Gemini). Powers critique. |
| POST | `/api/video` | bearer, **credits** | Product video. `voiceover` cheap / `veo` = 400 credits (`CREDIT_COSTS.video_veo`). |
| POST | `/api/creator/model-shots` | bearer, **credits** | On-model image gallery (Nano Banana). Debits 25 (`model_shots`). |
| POST | `/api/creator/first-drop/propose` | bearer, RL | The EVE-GUIDED first-drop door (2026-08-20): Gemini invents palette-constrained demo-product concepts for her to pitch aloud. Pure proposal, nothing spent. Gift-gated: 403 once the store has 4+ products. |
| POST | `/api/creator/first-drop/create` | bearer, RL | Builds ONE approved first-drop concept end-to-end (design → composition → mockup → publish) as the FREE onboarding gift via the internal identity — fire-and-forget, returns `{started, remaining}`. Same gift gate. `lib/first-drop.ts` is the shared pipeline behind both this and the silent `AUTO_FIRST_DROP` door. |
| POST | `/api/creator/model-videos` | bearer, RL, **credits** | On-model Veo film for the website (appends, max 3 angles). Debits 400; rate-limited. |
| POST | `/api/creator/scene-video` | bearer, RL, **credits** | "Cool short" on fal.ai — pick `wan` (60) / `seedance` (260) / `veo3` (400); variable charge. |
| POST | `/api/creator/preview-shots` | bearer, **credits** | On-model PREVIEW photos at the placement step, BEFORE a composition exists — real Printful mockup first, then Nano Banana puts it on a model. Debits 16 (`preview_shots`); nothing persisted (client caches per session). |
| POST | `/api/creator/design-feather` | bearer | Photoshop-style edge feather on a design's PNG — deterministic pixel op (no AI, no credits); saves the feathered image as the design's new url. |
| POST | `/api/creator/enhance-copy` | bearer, RL | AI-improve one mini-CMS copy field in the brand's voice (the ✦ Enhance button in the Customize-site editor). Free, like `/api/enhance`. |
| POST | `/api/creator/plan-site-edits` | bearer | Distill a live-site critique conversation into a plan: `images` (direct slot swaps via `/api/creator/site-assets`) + `edits` (forge work, each optionally carrying new `assets` to generate). |

### Dev / Gen Lab (admin-gated)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/dev/logo` | bearer (admin/comp) | Gen Lab harness for Eve's exact logo pipeline (`lib/logo.ts` — same prompt assembly, retry, chroma-key). Uploads land in `nanocrew/logo-lab`. |
| POST | `/api/dev/logo-kit` | bearer (admin/comp) | Gen Lab harness for the full LogoKit (`lib/logo-kit.ts` — 2 masters + derived assets). Same gating. |
| POST | `/api/dev/log-conversation` | dev only | Persist live-conversation transcripts to gitignored `local-logs/` for Eve tuning. Hard-disabled in production. |

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
| POST | `/api/report` | bearer | Report Market content (Apple 1.2 UGC moderation) — always logs server-side + fires the ops email via `internal/notify`; no DB write (pairs with the on-device block, `lib/blocklist.ts`). |
| GET | `/api/public/stores/:slug/products` | — | (App-side mirror) headless catalog. |
| POST | `/api/public/beacon` | — | Anonymous pageview tick. |

### Customer (signed-in buyer) — the "Purchases" surface

Distinct from the **creator** routes (which scope by store): these scope by the buyer's **account
email** (`lower(customerEmail) = lower(user.email)`; `creators.email` is UNIQUE so the match is
unambiguous). DIRECT APIs (plain DB reads / a thin proxy), not the forge. See
[ORDERS.md](../accounts/ORDERS.md) + [RETURNS_REFUNDS.md](../accounts/RETURNS_REFUNDS.md).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/customer/orders` | bearer | The buyer's orders (newest first, ≤100), each with items, status, tracking, return window, and a `canRequestReturn` flag. Backs the app **Purchases** section. |
| POST | `/api/customer/returns` | bearer | Thin proxy for the in-app **"Request a return"** action — resolves the signed-in buyer and forwards `{ orderId, reason, photoUrls?, note?, items? }` + the verified account email to platform-api `POST /api/public/returns` (returns logic + emails stay central, thin-client rule). **503** if `PLATFORM_API_BASE` unset. |

## 5. Billing & credits

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/creator/credits` | bearer | Balance, op costs, ledger. Grants the signup bonus on first call. |
| POST | `/api/creator/onboarding` | bearer | Record the welcome-flow choice (`path: 'subscribe' \| 'free' \| 'shop'`) and grant starting credits idempotently — free → `SIGNUP_BONUS` (300) on first touch; shop → account with NO creator credits; subscribe → `WELCOME_CREDITS` ($10) once, only after a paid plan verifies server-side. |
| GET | `/api/creator/subscription` | bearer | Plan + entitlements, brand count vs cap, tiers + credit packs. |
| POST | `/api/creator/billing/checkout` | bearer | Stripe Checkout URL (`kind: subscription | credit_pack`). |
| POST | `/api/creator/billing/portal` | bearer | Stripe billing-portal URL. |
| POST | `/api/creator/billing/iap-verify` | bearer | Apple IAP (StoreKit 2) — client sends `{ transactionId }` (`appAccountToken` = creator id); the server pulls the signed transaction via the App Store Server API (`src/lib/app-store.ts`, no legacy verifyReceipt), then grants credits **or** activates the subscription + first month. Idempotent on the transactionId. Needs `APPLE_IAP_*` + `APPLE_BUNDLE_ID`. |
| GET/POST | `/api/creator/connect` | bearer | Read / start Stripe Connect onboarding for creator payouts. |

### Internal jobs (server-to-server, `INTERNAL_API_KEY`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/internal/release-payouts` | `x-internal-key` (constant-time) | The deferred-payout **release job** (Cloud Run, persistent). Scans `orders WHERE payoutStatus='held' AND payoutReleaseAt < now() AND status NOT IN (return_requested, returned, refunded, cancelled, failed)` and transfers each brand its `brandNetCents` (`source_transaction = stripeChargeId`), setting `payoutStatus='released'`. Idempotent (per-order Stripe idempotency key). Returns `{scanned, released, failed, errors}`. **Owner config:** a Cloud Scheduler/Vercel cron must hit it on an interval; alert on a non-zero `failed`. See [RETURNS_REFUNDS.md](../accounts/RETURNS_REFUNDS.md). |

---

## 6. platform-api (Vercel, `nanocrew-api.vercel.app`)

### Public storefront reads (CORS)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/public/stores/:slug` | Brand facts for the live OG overlay; now also returns `isPublic` + `status`. |
| GET | `/api/public/stores/:slug/products` | Headless catalog. **Returns products each with a NESTED `variants[]` array** (`{id, sku, color, size, retailPriceCents, inStock}`, size-sorted); products with zero variants are dropped. |
| GET | `/api/public/stores/:slug/collections` | Drops + counts. |
| GET | `/api/public/stores/:slug/videos` | Featured on-model film wall (Veo) for the homepage. |
| GET | `/api/public/stores/:slug/posts` | Published journal for the website. |
| GET | `/api/public/stores/:slug/posts/:postSlug` | One journal post. |
| GET | `/api/public/stores/:slug/site-assets` | Creator graphics (logo, hero, sections, OG) merged **live** over the template placeholders. |
| GET | `/api/public/stores/:slug/site-config` | Mini-CMS copy/colors/fonts overrides, read live over the baked `brand.json`/`copy.json` — no rebuild. |
| POST | `/api/public/checkout` | **The POS.** Storefront cart → Stripe Checkout; validates store/variant ownership, in-stock, price. **Separate charges + transfers** (held-marketplace): captures 100% to the platform and persists the brand's net as HELD (`payoutStatus='held'`, `brandNetCents`, `connectedAccountId`) when the brand has a charges-enabled Connect account, else settles to the platform (`payoutStatus='none'`). CORS preflight (`OPTIONS`). **503** if Stripe unconfigured. See [RETURNS_REFUNDS.md](../accounts/RETURNS_REFUNDS.md). |
| POST | `/api/public/order-lookup` | **Guest return gate.** `{ email, orderNumber }` (the order id) → a minimal order view (`status`, items, tracking, `returnWindowEndsAt`, `inWindow`). Email + id must both match; same `404` either way (no order-existence leak). CORS preflight. |
| POST | `/api/public/returns` | **Open a return claim** (guest from a brand site OR the in-app proxy). `{ orderId, reason, photoUrls?, note?, items? }`; validates the window is open + reason in-enum (`defective`/`wrong_item`/`damaged`/`not_received`) + photo present for defective/damaged, inserts a `return_requests` row, flips the order → `return_requested`, and best-effort acks the buyer (`sendReturnRequested`). **400** bad reason / missing photo · **404** unknown order · **409** not shipped / window closed / not claimable. CORS preflight. See [RETURNS_REFUNDS.md](../accounts/RETURNS_REFUNDS.md). |
| POST | `/api/public/beacon` | Anonymous daily pageview tick. |

### `POST /api/public/beta-signup` — the nanocrew.app beta door

`{ email, platform: 'ios'|'android', source? }` → `{ ok, status: 'approved'|'waitlisted'|'failed', remaining }`.

The **only** writer of `beta_signups`. It lives here, not on nanocrew-site, because the site holds no
database credential — the site's `/api/waitlist` is a server-side proxy to this route (its old
`create table if not exists waitlist` against an unset `DATABASE_URL` silently no-op'd: no row, no
email, no invite — the 2026-08-18 signup that reached nobody).

- **Caps** at 50 approved rows **per platform**, counted live.
- Under the cap, **iOS** is added to the external TestFlight group through the App Store Connect API
  (`lib/testflight.ts`; env `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY`, `ASC_BETA_GROUP_ID`) —
  that call is what sends the invite. **Android** has no automated tester list yet, so those rows are
  collected and mailed at launch.
- Over the cap, or unautomated: `waitlisted` — mailed when the app opens up (`launch_emailed_at`).
- A store-API failure records `failed` + `error_msg`, **never** a false `approved`.
- Always emails ops (`OPS_EMAIL`) with who signed up and slots left, plus the signer's own
  approved/waitlisted mail. Sends are best-effort — a mail outage can't cost someone their place.
- Idempotent on `(email, platform)`; an existing `approved` row is never downgraded.

### Internal email dispatch (server-to-server, `INTERNAL_API_KEY`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/internal/notify` | `x-internal-key` (constant-time) | Central send dispatch so **app-side** creator actions (the app-backend approve/decline routes) can fire a branded shopper email **without** pulling Resend into the app — Resend lives ONLY in platform-api. Payload is a five-action union: returns `{ action: 'approved'｜'declined', returnId, reason? }` (resolves claim → store → buyer, dispatches `sendReturnApproved`/`sendReturnDeclined`) · `{ action: 'brand_live', slug }` (creator email) · `{ action: 'payout', orderId }` (creator email) · `{ action: 'report', targetType, slug, reason, reporter? }` (ops email, Market UGC) · `{ action: 'collab_invite', inviteId }` (invitee email). Best-effort: a configured-and-authed call always **202**s (a failed send never fails the creator action); **401** when the key is unset/mismatched. See [EMAIL_PIPELINE.md](../accounts/EMAIL_PIPELINE.md). |

### Billing return pages

| Path | Purpose |
|---|---|
| `GET /billing/success` | Post-checkout landing (reads `?plan=` / `?credits=`); deep-links back to `nanocrew://account?billing=success`. |
| `GET /billing/cancel` | Cancelled-checkout landing. |

### Webhooks

| Method | Path | Verification | Purpose |
|---|---|---|---|
| POST | `/api/public/stripe-webhook` | Stripe signature (`constructEventAsync`, `WEBHOOK_SECRET`) | Commerce: `checkout.session.completed` → paid order, captures `stripeChargeId` (the held-transfer `source_transaction`, from the PaymentIntent's `latest_charge`), submits to Printful, sends the order-confirmation email. `charge.refunded` → mark refunded + refund-confirmation email (covers dashboard refunds). **400** bad signature. |
| POST | `/api/public/billing-webhook` | Stripe signature (separate `STRIPE_BILLING_WEBHOOK_SECRET`) | Subscriptions + credit-pack grants. **400** bad signature. |
| POST | `/api/public/printful-webhook` | **Opt-in token** | Fulfillment lifecycle → tracking. `package_shipped` stamps `shippedAt` + `returnWindowEndsAt` = `payoutReleaseAt` = `shippedAt + RETURN_WINDOW_DAYS` (env, default 7) and sends the shipped + review-request emails (v1 review proxy — no carrier delivered event). When `PRINTFUL_WEBHOOK_TOKEN` is set, the caller must present a matching `?token=` (constant-time compared) — **401** otherwise; when unset, falls back to the store-id check (**403**). |

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


### `GET /api/public/invite/:token` · `POST /api/public/invite`
GET resolves an invite token to display copy (masked email). Unauthenticated — the token is the credential. Lets nanocrew.app host the invite page without DB access.
POST `{ token, action: 'accept' | 'decline' }` (Supabase bearer from the invite page) is the **web half** of collaboration invites — mirrors the app's `/api/creator/invites` accept/decline, with one web-only extra: it **ensures the `creators` row first**, so a brand-new invitee (no app sign-in yet) can accept.


### `GET/PATCH /api/creator/account`
The signed-in creator's own profile — `{ profile: { id, email, name, phone, image, createdAt }, plan }`.
PATCH accepts `{ name?, phone? }` only. **Email is intentionally not editable**: collaboration
invites (`store_invites.email`) and customer order-lookups match on it. Powers
`nanocrew.app/account`, the site's one signed-in surface; the app shows this identity read-only.


### Creator routes on platform-api (the web's authed surface)
- `GET /api/creator/stores` — every brand the creator can reach: `{ id, slug, name, status,
  customDomain, role: 'owner'|'collaborator' }`. Owners sort first.
- `GET/POST/DELETE /api/creator/stores/:slug/collaborators` — members + pending invites, invite by
  email, remove a member or revoke an invite. **Owner-only** (not `storeForMember`): a collaborator
  must never be able to remove the owner. Non-owners get an opaque 404 on every verb.

Invite emails for BOTH this route and the app's (via `/api/internal/notify`) go through
`lib/collab-invite.ts` — one implementation, so the link and copy can't drift.

**Which backend serves what.** The site uses two bases, deliberately:
- `platform.nanocrew.app` (platform-api) — anything needing `PATCH`/`DELETE`, because we control its
  CORS: account, collaborators, stores.
- `api.nanocrew.app` (the app's Cloud Run backend) — **Stripe Connect payouts only**
  (`GET/POST /api/creator/connect`). Its CORS is emitted by the Expo server runtime and allows only
  `GET, POST, OPTIONS`, so nothing needing another verb can live there — but reusing it avoids a
  second Connect integration against one Stripe account.
