# Nanocrew — Brand Lifecycle & Flow Roadmap

The end-to-end flow we're building toward, an audit of where the code is today, and the
sequenced work to close the gap. Written 2026-06-13.

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

### Phase A — Forge reliability (G1)  ·  unblocks everything, partly already agreed
- Reinstall Playwright/Chromium + `render.mjs` under the **`forge`** user (currently under `root`).
- **Persistent per-store clone**: `git fetch && checkout main && reset --hard && clean -fd` then branch,
  instead of `rm -rf && clone` each time. Reuse `node_modules`.
- **Shared deps** via pnpm content-addressed store (all stores share identical Next deps) → repos go
  back to ~tiny. (Alt: LRU-evict idle clones.)
- **Queue + single forge worker**: API route only enqueues (`status:'building'`); a worker on the
  forge drains one job at a time with a **per-store lock**. Fixes serverless-can't-run-30-min-jobs and
  multi-user contention. Parallelism later needs a bigger droplet.

### Phase B — Lifecycle state machine (G2)
- Define transitions: `building` (provisioning) → `ready` (preview deployed, creator reviewing) →
  `live` (domain attached + published). Wire them in provision/revise/go-live; `isPublic` gates the
  in-app marketplace separately.
- Add `PATCH /api/creator/stores/:slug` for post-creation settings (name, domain, go-live).
- Treat `store-<slug>.vercel.app` as the **preview**; "live" is the custom domain.

### Phase C — Domains (G3)
- Pick a path: **Vercel-managed domain purchase** (simplest — Vercel Domains API buys + auto-configures
  on the project) vs an external registrar (Namecheap/Cloudflare) + transfer/DNS instructions.
- Flow: creator searches/buys (or enters a domain to transfer) → charge via Stripe → call Vercel
  Domains API to add+verify on the `store-<slug>` project → write `stores.customDomain` → status `live`.
- The public API keys off `slug` (in `brand.json`), so the site keeps working on the new origin with no
  template change beyond CORS allowance.

### Phase D — Stripe Connect (G4)
- **Onboarding**: create an Express/Standard connected account at (or shortly after) brand creation;
  store `stripeAccountId` in `connected_accounts`; an account-link onboarding URL surfaced in the app.
- **Routing**: storefront checkout creates the session **on the connected account** with
  `application_fee_amount` (platform cut). Refunds/disputes via Connect.
- **Gate**: block "go live" until `charges_enabled` (the brand can actually take its own money).

### Phase E — Per-brand Printful (G5, optional)
- If required: populate `stores.printfulStoreId` and route publish + fulfillment per brand. Otherwise
  record "shared Nanocrew Printful store" as the intentional v1 model.

## Open decisions (need Joe)
1. **Domain provider** — Vercel-managed purchase (fastest) vs external registrar + transfer support?
2. **Stripe at launch** — Connect required for v1 (true per-brand payouts), or platform-settles +
   manual payout for v1 with Connect right after? (PRODUCTION_CHECKLIST already flags this.)
3. **Go-live gating** — is a live site allowed before Stripe Connect is complete (browse-only), or is
   payment-ready a hard requirement to go live?
4. **Printful** — shared store for v1 (recommended) or per-brand now?
