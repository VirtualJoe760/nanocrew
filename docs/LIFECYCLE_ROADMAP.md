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

### Phase C — Domains (G3)  ·  **Vercel for everything** (decided)
- Use the **Vercel Domains/Projects API** for the whole flow — buy a new domain *or* transfer an
  existing one in (TXT-record ownership proof), add it to the `store-<slug>` project, verify.
- Flow: creator searches/buys (or enters a domain to transfer) → charge via Stripe → Vercel API
  add-domain + verify on the project → write `stores.customDomain` → **status `live`**.
- **Go-live == domain attached** (decided). The site lives at `store-<slug>.vercel.app` as the
  preview/working URL the whole time; pointing it at a domain is the official launch.
- The public API keys off `slug` (in `brand.json`), so the site keeps working on the new origin with no
  template change beyond CORS allowance.

### Phase D — Stripe Connect (G4)  ·  **created at brand establishment** (decided)
- **Born connecting**: when Venus establishes the brand (`/api/store`), create the brand's **Stripe
  Connect account** via API and store `stripeAccountId` in `connected_accounts`; surface an
  account-link onboarding URL in the app so the creator finishes verification.
- **Routing**: storefront checkout creates the session **on the connected account** with
  `application_fee_amount` (platform cut). Refunds/disputes via Connect.
- **Gate**: block go-live until `charges_enabled` (a live store can take its own money).
- Requires Stripe **Connect enabled** on the platform account.

### Phase E — Printful per-brand  ·  **one account, separation in OUR DB** (decided)
- Printful's API has **no store-creation endpoint** (verified — `GET /store` only; stores are
  dashboard-only). So per-brand Printful *stores* can't be provisioned programmatically.
- **Decision**: keep **one Printful account/store**. Per-brand **separation + earnings tracking live in
  our DB** — every product/variant/order is `storeId`-scoped with `printfulCostCents`, so per-brand
  revenue/cost/profit is exact (already powers in-app margins/insights). Tag Printful sync products per
  brand (name prefix / `external_id`) for dashboard clarity. The brand's "collection" is the
  `catalogues` row created at brand establishment. `stores.printfulStoreId` stays available only for the
  rare manually-provisioned per-brand store.

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
