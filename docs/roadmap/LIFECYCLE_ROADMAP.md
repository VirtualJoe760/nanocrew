# Nano Crew — Brand Lifecycle & Flow Roadmap

The canonical doc for the brand **build → edit → domain → go-live → Connect** lifecycle: the
end-to-end flow, an audit of where the code is today, and the sequenced work. Written 2026-06-13.

> **Status: Phases A–D are code-complete** (forge reliability, lifecycle state machine, domains,
> Stripe Connect); Phase E needed no code. Domains + Connect are **inert until Joe's account config**
> (see the bottom of this file). For the full feature roadmap across the app, see
> **[REMAINING_FEATURES.md](REMAINING_FEATURES.md)** (canonical).

## Target flow
1. **Create brand** — Venus interviews the creator → brand identity.
2. **Build site** — Claude provisions a per-brand repo + storefront on the forge, deploys to a
   working/preview URL. The site is **born wired to Stripe (the brand's) + Printful**, so products
   the creator adds appear and are purchasable automatically.
3. **Edit** — creator marks up the live preview; Venus notates each change.
4. **Apply** — Claude applies the batch on a branch → preview → creator approves → merge.
5. **Finalize + domain** — creator submits final and **buys or transfers a custom domain**.
6. **Go live** — the site is published on that domain (production); status → `live`.
7. **Posts anytime** — creator returns to publish journal posts whenever (no rebuild).

Cross-cutting guarantees:
- **Products auto-appear** on the site via the public catalog API; **placeholders only** when the API
  has nothing/΄is unreachable.
- Every provisioned template is **already connected** to the brand's payment (Stripe) + manufacturing
  (Printful) — adding a product Just Works end to end.

## Current state (audit, with the spine that already works)
- ✅ **1 Create brand** — `/api/store` → `stores` row (`status:'building'`), logo, OG, first catalogue.
- ✅ **2 Build site** — `src/lib/provision.ts`: creates GitHub `store-<slug>`, sparse-clones the
  template by `designStyle`, writes `brand.json` (incl. `apiBase`, `slug`), runs Claude on the forge,
  `npm run build` gate, push to `main`, Vercel project + deploy → `store-<slug>.vercel.app`. The site
  is **immediately public** there.
- ✅ **3–4 Edit / apply** — `src/lib/revise.ts`: clone → branch → Claude (with annotated forge
  screenshots) → build gate → push branch → Vercel preview → approve merges to `main`.
- ✅ **7 Posts anytime** — `store_posts` (DB) → public posts API (2-min cache) → template blog pages.
  No rebuild; ~2–4 min to appear.
- ✅ **Products auto-appear + placeholders** — templates' `getProducts()` hits
  `/api/public/stores/:slug/products` (ISR 300s), falls back to `PLACEHOLDER_PRODUCTS`. `apiBase` is
  baked into `brand.json` at provision.
- ⚠️ **Printful** — products publish to **one shared store (18313070)**; `stores.printfulStoreId`
  exists but is unused. Fulfillment routes via the shared account (`PRINTFUL_STORE_ID`).
- ❌ **Stripe** — one **platform account** for all stores (`platform-api/lib/stripe.ts`). No Connect
  onboarding; `connected_accounts` + `orders.application_fee_cents` exist but are unwired. Checkout
  settles to the platform, not the brand.
- ❌ **5 Domain** — `customDomain` is read in a couple of places but **never written**. No registrar,
  DNS, or Vercel Domains API anywhere.
- ❌ **6 Go live** — no draft→live gate. `status` only ever reaches `'live'` via the optional
  auto-first-drop; `approveRevision` doesn't touch it. The site is public from step 2 onward.

## Gaps to close (priority order)
- **G1. Forge reliability (foundation).** Re-clones every revise; 536 MB `node_modules` per store; no
  queue; Playwright installed as `root` but the forge runs as `forge` (screenshots silently no-op).
- **G2. Lifecycle state machine.** A real `building → ready → live` progression with explicit
  transitions; treat `vercel.app` as the preview/staging URL and "live" as domain-attached + public.
- **G3. Domains.** Purchase/transfer + attach to the Vercel project + write `customDomain`.
- **G4. Stripe Connect.** Born-connecting at brand creation; route checkout through the brand's
  account with an application fee; gate go-live on onboarding complete.
- **G5. (optional) Per-brand Printful.** Only if isolation per brand is required; otherwise document
  the shared-store model as the v1 decision.

## Roadmap

### Phase A — Forge reliability (G1)  ·  unblocks everything
- ✅ Playwright/Chromium + `render.mjs` reinstalled under the **`forge`** user (was under `root` →
  screenshots silently no-op'd). Verified rendering as forge.
- ✅ **Persistent per-store clone**: revise reuses the clone (`git fetch → reset --hard → clean →
  branch`); `node_modules` is gitignored so it survives. Warm `pnpm install` ≈ 2.3s.
- ✅ **Shared deps** via pnpm content-addressed store: a 2nd identical store adds ~7 MB (vs ~534 MB
  with npm); ~100 stores ≈ 1.2 GB not ~53 GB. Build verified clean under pnpm.
- ✅ **Per-store `flock` lock** in provision + revise (same-store safety).
- ✅ **Global serialization**: the per-store lock is now a single global `~/stores/.forge.lock` in
  provision + revise → never two forge jobs at once (RAM-safe).
- ✅ **Queue + single forge worker**: `/api/creator/revise` only enqueues (`store_revisions`
  `status:'building'`, annotations in the `screenshots` jsonb); a persistent **forge worker**
  (`forge-worker/`, systemd `nanocrew-forge-worker` on the droplet) drains the queue one job at a time
  and runs the pipeline **locally** (no SSH, serverless-safe). Verified end-to-end: enqueue → worker
  picks up → local clone/pnpm/Claude/build/push → preview → `ready`. Provisioning still fires from the
  app server but shares the global lock. Parallelism beyond 1 needs a bigger droplet.

**Phase A is complete.** ✅

### Phase B — Lifecycle state machine (G2)  ·  ✅ done
- ✅ `store_status` now `draft → building → ready → live → suspended` (added `ready`, migration 0014,
  synced to the platform-api copy). `building` = provisioning, `ready` = on the `store-<slug>.vercel.app`
  preview (reviewable/editable), `live` = custom domain attached (realized in Phase C). `isPublic` gates
  the in-app marketplace separately.
- ✅ Transitions wired: `provisionStorefront` sets `ready` on success (was stuck at `building`);
  first-drop sets `ready` (not `live`). Existing stores normalized (domainless `live` → `ready`).
- ✅ `GET/PATCH /api/creator/stores/:slug` for post-creation settings (name, tagline, descriptionMd,
  isPublic). Slug stays immutable. **The `live` transition (domain attach + go-live) is Phase C.**

### Phase C — Domains (G3)  ·  **Vercel for everything** (decided)  ·  ✅ done (code)
- ✅ `src/lib/domains.ts`: `attachDomain` (Projects API, idempotent; 409 → re-verify), `searchDomain`
  + `buyDomain` on Vercel's **Domains Registrar API** (`/v1/registrar/...` — the old `/v4/domains/*`
  + `/v5/domains/buy` were sunsetted Nov 2025; verified live), `domainCredits(priceUsd)` (yearly price →
  credits, 1.25× over cost), `normalizeDomain`. Buy passes the platform registrant contact + an
  expectedPrice that must match; the buy endpoint never refunds once the domain is bought (retries
  attach, reports "registering" on lag).
- ✅ **Own / transfer a domain**: `POST /api/creator/stores/:slug/go-live { domain }` attaches to the
  `store-<slug>` project; verified → writes `customDomain` + status `live`; pending → returns the DNS
  records to set, re-check by calling again.
- ✅ **Buy a new domain**: `GET …/domain/search?q=` (price + credit cost) and `POST …/domain/buy`
  (re-prices server-side, charges **credits** — reusing the existing rail, no Stripe-live dependency —
  buys on Vercel, attaches, flips to `live`, refunds credits on failure).
- ✅ **In-app go-live UI**: `src/components/go-live-composer.tsx` (own/transfer with DNS records, or
  search+buy with credits), opened from the Studio **Edit site** tab; live status shown inline.
- **Go-live == domain attached** (decided). The site lives at `store-<slug>.vercel.app` as the
  preview/working URL the whole time; pointing it at a domain is the official launch.
- ✅ **Verified live (2026-06-14)**: registrar availability + price return real data with the current
  `VERCEL_TOKEN`; the Projects domains API (attach/verify) works. Attach/connect of an owned domain is
  fully functional now.
- ⏳ **Needs Joe's config to BUY**: set `DOMAIN_CONTACT_*` (registrant: FIRST_NAME, LAST_NAME, EMAIL,
  PHONE [E.164], ADDRESS1, CITY, STATE, ZIP, COUNTRY [ISO-2]) — the registrar requires full contact on
  every purchase — plus a billing method on Vercel. Without those, search + attach work; buy returns a
  clear "registrant not configured" error.
- Note: domain purchase charges the platform's Vercel account; we recoup via the creator's credits.
  (The roadmap originally said "charge via Stripe" — credits are the simpler v1 and already paid-for.)

### Phase D — Stripe Connect (G4)  ·  **created at brand establishment** (decided)  ·  ✅ done (code, inert)
- ✅ **Born connecting**: `/api/store` fires a best-effort `ensureConnectedAccount(creatorId, email)`
  at establishment (Express account, `metadata.creatorId`, stored in `connected_accounts`). Never
  blocks store creation — no-ops if Connect isn't enabled yet.
- ✅ **`src/lib/connect.ts`** (REST, no SDK — mirrors billing.ts): `ensureConnectedAccount`,
  `createOnboardingLink` (account_links), `refreshConnectedAccount` (GET account → sync flags),
  `getConnectedAccount`, `goLiveBlockReason`, `connectEnabled()`.
- ✅ **Onboarding UI**: `GET/POST /api/creator/connect` + a "Set up payouts / Finish setup / Payouts
  active" button on the Account screen (opens the Stripe-hosted account link).
- ✅ **Routing**: storefront checkout (`platform-api`) uses a **destination charge** — when the brand's
  creator has a `charges_enabled` account it adds `payment_intent_data.transfer_data.destination` +
  `application_fee_amount`, persists `applicationFeeCents`, and settles the brand's profit to them.
  (Destination, not direct-on-account as the sample demoed, so the **existing platform webhook stays
  intact**.) Fee = COGS (`printfulCostCents`, fallback `DEFAULT_COGS_PCT`) + shipping + commission
  (`PLATFORM_COMMISSION_PCT`, default 10%); brand gets the remainder. No account → settles to platform
  exactly as before.
- ✅ **Webhook sync**: `account.updated` updates `connected_accounts` capability flags;
  `charge.refunded` marks the order `refunded` (covers dashboard-initiated refunds).
- ✅ **Refunds (Connect-aware)**: `POST /api/creator/orders/:id/refund` (platform-api, CORS,
  ownership-checked) refunds in full and — for a destination-charge order — sets `reverse_transfer` +
  `refund_application_fee`, so the brand's transfer and the platform fee are both clawed back
  proportionally. Surfaced as a **Refund** button on the brand-site `/admin` order list.
- ✅ **Gate**: `goLiveBlockReason` blocks go-live + domain-buy until `charges_enabled` — **only when
  `STRIPE_CONNECT_ENABLED` is set**, so the current domain flow is unaffected until Connect is on.
- ✅ **Processing fee**: checkout adds a customer-paid "Processing fee" (grossed up, waived at
  `PROCESSING_FEE_WAIVE_CENTS`, default $200), folded into the application fee so the platform keeps it;
  the cart shows a "save ~X% over $Y" nudge from `brand.json` `commerce` (no fee wording pre-checkout).
- ⏳ **Needs Joe's config**: enable **Connect** on the platform Stripe account, set
  `STRIPE_CONNECT_ENABLED=1`, and add `account.updated` + `charge.refunded` (connected-account events)
  to the platform-api webhook. Optionally tune `PLATFORM_COMMISSION_PCT` / `PROCESSING_FEE_*`.

### Phase E — Printful per-brand  ·  **one account, separation in OUR DB** (decided)  ·  ✅ no code needed
- Printful's API has **no store-creation endpoint** (verified — `GET /store` only; stores are
  dashboard-only). So per-brand Printful *stores* can't be provisioned programmatically.
- **Decision**: keep **one Printful account/store**. Per-brand **separation + earnings tracking live in
  our DB** — every product/variant/order is `storeId`-scoped with `printfulCostCents`, so per-brand
  revenue/cost/profit is exact (already powers in-app margins/insights). Tag Printful sync products per
  brand (name prefix / `external_id`) for dashboard clarity. The brand's "collection" is the
  `catalogues` row created at brand establishment. `stores.printfulStoreId` stays available only for the
  rare manually-provisioned per-brand store.
- ✅ **Fulfillment + returns tracking**: the Printful webhook maps the full lifecycle to `order_status`
  — `package_shipped`→shipped, `package_returned`→returned, `order_put_hold`→on_hold,
  `order_remove_hold`→in_production, `order_failed`→failed, `order_canceled`→cancelled. Printful's
  `order_refunded` is merchant-side (refunds OUR fulfillment cost, not the shopper) so it's logged
  only — the customer order status is unchanged; a shopper refund only ever comes from a Stripe refund.
  Added `on_hold`/`returned`/`failed` to the enum (migration 0015). A `returned` or `on_hold` order is
  still refundable from `/admin`.

## Locked decisions (Joe, 2026-06-13)
1. **Domains** — Vercel for everything (purchase **and** transfer); go-live = domain attached.
2. **Stripe** — create the brand's Connect account at establishment; checkout routes through it.
3. **Printful** — one account; per-brand separation + earnings in our DB (Printful can't create stores
   via API); tag products per brand.
4. **Go-live** — pointing the site at a domain is the official launch (`status: live`).

## Still needs Joe's account config
- **Stripe Connect** enabled on the platform Stripe account (for per-brand connected accounts).
- **Vercel token** scope that permits domain purchase + project-domain management; a billing method on
  Vercel for domain purchases.
