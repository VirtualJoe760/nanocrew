# Nano Crew — Architecture

> **Last refreshed 2026-06-20.** This is the authoritative system map — read it before changing
> anything, and keep it true as the system moves. It is verified against the code, not memory; when
> it disagrees with the code, that's a bug in one of them — surface it.

Nano Crew is AI-native creator commerce (Expo / React Native, iOS + Android). A creator talks to
**Eve** (voice or typed AI) to define a clothing brand; Nano Crew auto-generates a Printful-backed
shop **and** — for Pro+ — a per-brand storefront website, then lets them design products, post, sell,
and edit their site by chatting. The lifecycle is **build (instant + presentable) → refine (Design
generator swaps in real assets) → publish (list in-app / web, optionally link a custom domain)**.

Companion docs: [DATABASE_PLAN.md](DATABASE_PLAN.md) · [API.md](API.md) ·
[STOREFRONT_ENGINE.md](../storefront/STOREFRONT_ENGINE.md) (build/revise mechanics) ·
[STOREFRONT_DATA_CONTRACT.md](../storefront/STOREFRONT_DATA_CONTRACT.md) (the live data flow) ·
[TEMPLATE_AUTHORING.md](../storefront/TEMPLATE_AUTHORING.md) +
[COMPONENT_SYSTEM.md](../storefront/COMPONENT_SYSTEM.md) (authoring templates) ·
[BUILD_FLOW.md](../studio/BUILD_FLOW.md) + [FORGE_AI.md](../studio/FORGE_AI.md) (the Eve→forge arc) ·
[PAGES.md](../app/PAGES.md) · [PRODUCTION_CHECKLIST.md](../ops/PRODUCTION_CHECKLIST.md).

## The four deployable units (one shared Supabase Postgres)

| Unit | What | Where it runs |
|---|---|---|
| **Mobile app** | The product — Expo / React Native (this repo). Its `src/app/api/**+api.ts` server routes hold the authenticated **creator** logic (design, publish, billing, site edits). | **Google Cloud Run** — `api.nanocrew.app` (direct URL `backend-927523030808.us-west1.run.app`), a persistent Node server (`expo serve`). The iOS build's `EXPO_PUBLIC_API_URL` points here. Deploy with `./scripts/deploy-cloudrun.sh nanocrew-api us-west1 backend`. **Not EAS Hosting** (see below). |
| **platform-api** | The **public** Next.js API the storefront websites consume + all webhooks. Holds the central commerce + secrets. | Vercel — `nanocrew-api.vercel.app` (rootDirectory `platform-api/`). |
| **nanocrew-templates** | Sibling repo of **5** self-contained Next.js storefront templates — `minimal · bold · elegant · extravagant · street`. One `brand.json` token file turns a template into a brand. | GitHub source; each provisioned brand → its own Vercel project. |
| **forge** | DigitalOcean droplet running headless Claude. A systemd **`nanocrew-forge-worker`** drains the revision queue and provisions/revises brand websites **locally** on the box. | VPS (`ssh nanocrew-forge`). |

All four share **one Supabase Postgres** (Drizzle ORM). **`platform-api/db/schema.ts` is a COPY of
`src/db/schema.ts`** — re-sync it on every migration (this is the #1 invariant that bites). The
`./nanocrew-site` Next.js app (the `nanocrew.app` marketing site + the company store + the free
`nanocrew.app/b/<slug>` web storefronts) lives in this repo and also reads platform-api.

### Why the app backend is a PERSISTENT NODE SERVER, not EAS Hosting

EAS Hosting runs on Cloudflare Workers. Opening a postgres-js **TCP** socket there is unreliable
across requests — and worse, opening one *after* an outbound `fetch()` in the same request reliably
fails, which broke every authed DB route. The backend therefore runs as a persistent Node process
(`expo serve`), where a normal pool survives between requests (`src/lib/db.ts`, Supabase transaction
pooler, `prepare: false`). **Do not move it to an edge/Workers runtime.**

**Host history:** originally Railway; migrated to **Google Cloud Run** (Jul 2026) when Railway's
trial ended and its edge started returning `404 Application not found`, which took the native app
offline. The container (`Dockerfile`) just runs `expo export -p web` → `expo serve`, so the deploy is
host-portable — any Node container platform can run it. Cloud Run specifics: free tier, `min-instances=0`
(so expect a cold start after idle), 53 runtime env vars injected from `.env.local` by the deploy script.

Two more workarounds stem from `expo serve`'s per-request isolation:
- **Cloudinary** uploads go through the **signed REST API** (`src/lib/cloudinary.ts`), not the SDK —
  the SDK's `upload_stream` silently fails in that runtime. Files go as a base64 data URI over
  `application/x-www-form-urlencoded` (no FormData/Blob).
- **Cross-request caches** (e.g. TTS) are stored as Cloudinary `raw` blobs and re-fetched by URL.

## Auth

`src/lib/auth.ts` `getUserFromRequest()` verifies the Supabase access token **locally** — no
per-request network call. It checks the **ES256** signature against the project JWKS (read from the
`SUPABASE_JWKS` env so there's zero I/O in the hot path; falls back to fetching + caching the JWKS if
unset), pins `alg=ES256`, requires `aud=authenticated`, checks `exp` and issuer. Local verify
matters because authed routes must make **no `fetch` before their DB query** (the persistent-Node/Workers note
above). There's also a **server-to-server bypass**: a request with a valid `x-internal-key`
(constant-time compared to `INTERNAL_API_KEY`) plus `x-internal-creator` authenticates AS that
creator — used by `AUTO_FIRST_DROP` generation, which calls the now-authed designer routes.

**One Supabase identity is the whole account model.** `creators.id = supabase uid`, email unique;
orders link to a person by `customerEmail`. See [AUTH_IDENTITY.md](../accounts/AUTH_IDENTITY.md).
The **app** verifies tokens locally; **platform-api** (a separate deploy) verifies remotely. Authed
client calls use `apiFetch()` (`src/lib/api.ts`, attaches the token). Designer + creator endpoints are
per-creator scoped (`src/lib/tenant.ts`); paid AI endpoints are credit-gated (`src/lib/credits.ts`)
and rate-limited (`src/lib/rate-limit.ts`).

## The thin-client storefront model (the load-bearing design)

**Templates are THIN CLIENTS — no commerce backend, no secrets, ever.** A brand site is a headless
read-client of platform-api; all money, fulfillment, and POD provider logic live in exactly one place.

- **Checkout** → `POST ${brand.apiBase}/api/public/checkout` — the central **POS** on platform-api.
  Prices come from the DB (the client cart is untrusted), an order row is created `pending_payment`,
  Stripe Checkout returns a URL, and the webhook flips it to `paid` and hands it to Printful. No brand
  repo ever holds a Stripe or Printful secret.
- **POD providers** live in one registry: `POD_PROVIDERS` in `src/lib/pod-policy.ts` (Printful today;
  extend with one `ProviderPolicy` entry). The publish gate and the fulfillment safety-net
  (`platform-api/.../lib/fulfill.ts`) read it; templates know nothing about it. **Adding a provider is
  a platform-api change — zero template edits, for 5 templates or 50,000 sites.** That is the entire
  point of the thin client: commerce updates never ship to the fleet. See
  [POD_POLICY.md](../accounts/POD_POLICY.md).
- **Brand sites are env-less.** Template source has *zero* `process.env` reads — `apiBase`, the
  Supabase URL/anon key, and the fee terms are baked into **`brand.json`** at provision time (from the
  **app server's** env) and committed to the repo. So a new brand connects with no per-site env setup
  and "Login with Nano Crew" works out of the gate. (The lone exception is the bespoke, imported
  `stephenlawyer.clothing`, which predates this and reads `process.env.NANOCREW_API`.)

The full nested-variant product shape, collections, the checkout contract, and the ISR +
`revalidateStorefront()` sync rule are in
[STOREFRONT_DATA_CONTRACT.md](../storefront/STOREFRONT_DATA_CONTRACT.md) — read it before touching any
storefront's data layer.

### The public contract (`platform-api/app/api/public/`)

The only catalogue surface a storefront may use. Keep these in lockstep with the routes.

| Endpoint | Returns |
|---|---|
| `GET /stores/:slug` | brand facts incl. `isPublic` + `status`. |
| `GET /stores/:slug/products` | published products with **NESTED `variants`** (prices/sizes/colours live there, not flat) — reading the flat shape silently yields `$0.00`. |
| `GET /stores/:slug/collections` | collections / drops (cover image, season). |
| `GET /stores/:slug/posts[/:postSlug]` | blog posts (DB-backed; no forge, no rebuild). |
| `GET /stores/:slug/videos` | brand video assets. |
| `GET /stores/:slug/site-config` | the **mini-CMS** copy/colors/fonts overrides — read **live** and layered over the baked `brand.json`/`copy.json`; **drives SEO too** (title, meta, OG, JSON-LD). No rebuild. |
| `GET /stores/:slug/site-assets` | creator-generated **graphics** — `logo` (top-level `stores.logo_url`), `hero`/`sections`/`og` (`stores.site_assets` jsonb). Templates merge per-field `live ?? baked`. |
| `POST /checkout` | the shared POS (above). |
| `POST /beacon` | per-pageview counter into `page_views` (powers the /admin traffic chart). |

## The brand-identity model + the unified cascade

A brand's identity is **duplicated across many surfaces** by design (each is read on a different hot
path): the `stores` columns (`name`, `tagline`, `description_md`, `logo_url`, `og_image_url`), the
`brand_profile` jsonb (AI ground-truth), the mini-CMS `site_config.copy` overrides (which **win** on
the live site), and the per-brand repo's baked `brand.json` (which drives the site header + SEO).

**`src/lib/brand-identity.ts` `buildBrandPatch()` is the single source of truth** for an identity
edit — it computes the whole cascade so a rename/tagline/story edit can never leave one surface stale
(the "Alpha Master" meta-description class of bug). It: applies explicit field edits; on a **rename**,
swaps the old name → new everywhere it's embedded in copy (tagline, story, `brand_profile`,
`site_config.copy`, logo direction); and **clears the baked logo + OG card** so they regenerate. The
route applies `dbPatch` (one `stores` UPDATE) and pushes `brandJson` (one `brand.json` write), then
revalidates. Live-read overrides (`site-config` / `site-assets`) apply with **no rebuild**; identity
baked into `brand.json` (header + SEO) needs the `brand.json` push the cascade produces.

The app brand chrome itself is **cool monochrome + platinum-silver** (no gold); individual brand
storefronts keep their OWN colors. The app palette lives in **three** files that must stay aligned:
`src/constants/theme.ts`, `src/lib/studio-palette.ts`, `src/components/nc-screen.tsx` `makePalette`
(see [`../context/NEVER_VIOLATE.md`](../context/NEVER_VIOLATE.md) §3 for the canonical rule).

## End-to-end flow

```
Studio interview (Eve — voice/typed, push-to-talk)
   → BrandResult (name, tagline, palette, voice, story, designStyle, products, verbatim siteNotes)
   → creator reviews/edits on the BRAND COMPILED screen (incl. live template picker)
   → POST /api/store  (canLaunchStore gate: paid plan + brand cap)
       → generate logo (Gemini 2.5 Flash Image) + OG card; create store row + first catalogue
       → ensureConnectedAccount() (Stripe Connect, best-effort)
       → if Pro+ (website): provisionStorefront()  ── enqueues a job, NO SSH ──┐
       └→ (AUTO_FIRST_DROP=1) generateFirstDrop() → products                   │
                                                                               ▼
   provisionStorefront() (src/lib/provision.ts, on Cloud Run):            store_revisions queue
     • creates the per-brand GitHub repo  store-<slug>                  (branch '__provision__')
     • Eve AUTHORS briefs/01-BRAND.md (authorBrandBrief, gemini-2.5-pro;          │
       deterministic mail-merge fallback) + writes brand.json + 02-TEST.md          │
     • INSERTs a store_revisions row (branch '__provision__', status 'building')    │
   forge-worker (systemd, on the droplet) drains it ◄───────────────────────────────┘
     • sparse-clone the chosen template, `cp -R` into store-<slug>, write brand.json + briefs
     • headless `claude -p` applies the brand → build-gate (pnpm run build) → push main
     • deployToVercel(): create the Vercel project + production deploy
     • flip store → 'ready' with deployment_url; push the creator

Designer (Design tab) → /api/generate → /api/compositions → /api/mockup → /api/publish
   → live Printful sync product + local products/variants → feed + Market + site
   → revalidateStorefront(slug) rebuilds the brand's Vercel project (also on product delete)

Publish (decoupled from websites): POST /api/creator/stores/:slug/publish { listed }
   → isPublic + status='live' with only an active plan + ≥1 published product
   → lists in the in-app Market + on nanocrew.app/b/<slug>  (custom domain = a separate Pro upgrade)

Site LOOK edits: creator critiques in-app (chat or circle/arrow + voice)
   → /api/creator/revise ENQUEUES a store_revisions row (branch revision/<id>) + annotations
   → forge-worker applies ONLY that change on the branch → Vercel preview → creator reviews
   → approve → /api/creator/revisions/:id/approve merges branch→main (GitHub API) → production
   → decline → declineRevision() discards the branch (production was never touched)

Commerce: storefront → platform-api /public/checkout → Stripe → stripe-webhook
   → order paid → submit to Printful (fulfill.ts POD safety-net) → printful-webhook → tracking
```

### Provisioning & revisions are queue-based (no SSH)

The app server **never SSHes the forge** (it can't from a managed host). `provisionStorefront()` does
the cheap GitHub-API + brief-authoring work on the app backend, then **enqueues** a job into the
`store_revisions` table — provisioning uses the reserved branch `'__provision__'`, revisions use
`revision/<id>`. The single `nanocrew-forge-worker` (one job at a time, global `~/stores/.forge.lock`,
45-min provision / 30-min revision timeouts) polls that table and runs the heavy
clone→brand→build→push→Vercel pipeline **locally** on the droplet. The worker
(`forge-worker/worker.mjs`) is intentionally dependency-light and its bash is a **hand-kept mirror of
`src/lib/provision.ts` / `src/lib/revise.ts`** — change one, change the other. This makes the ~30-min
build independent of the app server staying alive. `revise.ts` on the app side now only does
**approve/decline** (merge/discard via the GitHub REST API) — the worker is the sole executor.

If the app server fails before it can enqueue, it un-sticks the store (`status` back to `'ready'`,
`deployment_url=null`) and records a **failed** `store_revisions` row, so failures are visible in the
console instead of silently flapping back to ready.

### Storefront freshness

Templates read platform-api at build/ISR time (`revalidate: 300`), so a catalogue change self-heals
within ~5 min *if the page is requested*. For immediacy, `src/lib/storefront-revalidate.ts`
`revalidateStorefront(slug)` fire-and-forget redeploys the brand's Vercel project (tries `<slug>` and
`store-<slug>` names); it's wired into `/api/publish` and product delete. Mini-CMS overrides
(`site-config` / `site-assets`, incl. the logo) are read **live** and need no rebuild at all.

## The Eve → forge build, and template authoring

**Eve (AI #1) authors the build brief; a conditioned forge Claude (AI #2) builds the site.** Eve
is the interpreter: she reads the chosen template's `TEMPLATE.md` (block spec + rules) and
`VOCABULARY.md` (creator-phrase → concrete block/file map) and writes `briefs/01-BRAND.md` as a
concrete, block-by-block plan, so the forge executes named blocks rather than decoding the creator's
loose words. The forge robot's standing rules live in a **Master `CLAUDE.md`**
(`forge-worker/forge-CLAUDE.md` → `/home/forge/.claude/CLAUDE.md`); the per-repo `brand.json` is law
(it never invents palette/typography), and `briefs/02-TEST.md` is the acceptance gate (clean build, no
new deps/routes, commerce rails untouched, no placeholder text). **CURRENT FOCUS:** the remaining
build-quality gap is giving the robot **eyes + a self-critique loop** and a real quality gate (no more
silent `|| true` ready-flip) — see [BUILD_QUALITY.md](../storefront/BUILD_QUALITY.md) +
[FORGE_AI.md](../studio/FORGE_AI.md).

**Direct vs forge.** Precise, deterministic actions go through **direct creator APIs** (blog posts,
mini-CMS copy/color/font edits, identity edits — a DB write, instant + reliable), NOT the forge. Only
open-ended creative work (build/edit a whole site) goes to the forge robot.

**Templates** are `cp -R`'d per brand at provision time, so a template change reaches only brands
provisioned after it (or via explicit rebuild). To author or register a template, read
**[TEMPLATE_AUTHORING.md](../storefront/TEMPLATE_AUTHORING.md)** (the thin-client invariant, the
contract every template must ship, and registration across `src/lib/interview.ts`,
`src/lib/live-voice.ts`, `TEMPLATE_BY_STYLE` in `src/lib/provision.ts`, and the branding picker in
`src/components/brand-review.tsx`); the target `_shared` + block-manifest architecture is in
**[COMPONENT_SYSTEM.md](../storefront/COMPONENT_SYSTEM.md)** (design, not yet built).

## Server-side libraries (`src/lib/`)

| Lib | Purpose |
|---|---|
| `db.ts` | Supabase Postgres via Drizzle + postgres-js (server-only; persistent pool, `prepare: false`). |
| `auth.ts` | `getUserFromRequest()` — local ES256 JWKS verify + constant-time internal-key bypass. |
| `tenant.ts` / `api.ts` | Per-creator scoping helpers · authed client `apiFetch()`. |
| `interview.ts` | The brand-interview brain — `interviewSystem`/`parseTurn` now reused by `/api/extract-brand` to turn the live transcript → `BrandResult`. `live-voice.ts` runs the realtime Gemini Live interview (the old turn-based `/api/voice` + `/api/interview` routes were removed). |
| `provision.ts` | Storefront provisioning — repo + `brand.json` + `authorBrandBrief` (AI brief, mail-merge fallback), then **enqueues** a `'__provision__'` job. |
| `revise.ts` | Post-review revision actions only — `approveRevision` (merge) / `declineRevision` (discard) via the GitHub API. |
| `brand-identity.ts` | `buildBrandPatch()` — the identity-edit cascade (the single source of truth). |
| `brand-config.ts` | `brand.json` patch helpers (typed). |
| `storefront-revalidate.ts` | Redeploy a brand's Vercel project after a catalogue change. |
| `first-drop.ts` | `generateFirstDrop()` — Gemini-invented first products (gated by `AUTO_FIRST_DROP`). |
| `printful.ts` | Printful REST client (catalog, mockups, sync products, orders, cost). |
| `pod-policy.ts` | `POD_PROVIDERS` registry + the pre-publish content-policy gate (provider print rules). |
| `cloudinary.ts` | Signed-REST media hosting (designs, videos, mockups, raw cache) — no SDK. |
| `transparency.ts` | Pure-JS magenta chroma-key (Nano Banana can't emit alpha; no native deps). |
| `content-safety.ts` | Generation NSFW/gore guard (prompt pre-check + Gemini safetySettings). |
| `og-image.ts` | Brand OG / avatar card (logo + tagline) as a Cloudinary transform. |
| `model-shots.ts` / `model-video.ts` / `veo.ts` / `scene-video.ts` / `fal-video.ts` / `voiceover-ad.ts` | On-model imagery + product/scene video (Veo 3, fal.ai tiers) + cheap VO ads. |
| `pricing.ts` | Single-source retail price from `variants.retailPriceCents` with a cost+$5 floor. |
| `billing.ts` | Subscription tiers + entitlements + `canLaunchStore()` + Stripe Checkout (REST). |
| `connect.ts` | Stripe Connect — one Express account per creator; storefront checkouts route via destination charges. |
| `domains.ts` | Custom-domain attach (Vercel + credits) — the separate Pro upgrade. |
| `credits.ts` / `comp.ts` | Credit metering (debit/grant/balance) · comp/internal accounts (free entitlements, debit no-op). |
| `rate-limit.ts` / `safe-fetch.ts` | Per-creator rate limiting · SSRF guard for creator-supplied URLs. |
| `iap.ios.ts` / `iap-products.ts` / `app-store.ts` | Apple IAP (StoreKit 2) client + catalogue + server verify (App Store Server API). |
| `push.ts` / `notify.ts` / `oauth.ts` | Push registration + delivery (Expo) · native Sign in with Apple. |
| `posts.ts` / `adapt.ts` / `effort.ts` / `voices.ts` | Feed posts · content adaptation · effort/spend · the AI consultant/ElevenLabs voice roster. |
| `studio-palette.ts` / `supabase.ts` | Studio modal palette · Supabase client. |

## Data model

Full table list in [DATABASE_PLAN.md](DATABASE_PLAN.md) and `src/db/schema.ts`. Tenancy root is
`creators → stores`; everything is `store_id`-scoped. Key groups: design (`catalogues`, `designs`,
`compositions`, `canvasNodes`), commerce (`products`, `variants`, `orders`, `orderItems`,
`pageViews`), content (`storePosts`), social (`productLikes`), billing (`subscriptions`,
`connectedAccounts`, `creditAccounts`, `creditLedger`), site editing (`storeRevisions` — **also the
provision/revision job queue** the forge worker drains, carrying `requestMd`, `branch`,
`transcript`, `editPlan`, circled `screenshots`, `previewUrl`, `errorMsg`, `status`), and
notifications (`deviceTokens`). Supabase **RLS is deny-all** on all public tables — every new
migration must `ENABLE ROW LEVEL SECURITY` on its new table.

## Invariants a new contributor must not break

> Canonical, enforced list (auto-checked before each commit): [`../context/NEVER_VIOLATE.md`](../context/NEVER_VIOLATE.md).
> The items below are the same rules with architectural context.

1. **Schema is duplicated.** `platform-api/db/schema.ts` is a copy of `src/db/schema.ts` — change
   both on every migration; new migrations must enable RLS on their new tables.
2. **The forge worker mirrors the app libs.** `forge-worker/worker.mjs`'s bash is a hand-kept copy of
   `src/lib/provision.ts` / `src/lib/revise.ts`; change one, change the other (and re-scp/redeploy the
   worker to the droplet).
3. **Templates are thin clients — no commerce backend, no secrets.** Checkout proxies to the central
   POS; POD providers + money live only in platform-api; brand sites are env-less (`brand.json`
   carries public config only).
4. **The database is the only catalogue.** A storefront never keeps its own product list; it reads
   platform-api at build/ISR time (Rule #1 of the data contract).
5. **Storefront features are wired at the TEMPLATE level**, never one-offed into a single brand's repo
   (Rule #2 of the data contract) — so every generated site ships them.
6. **Identity edits go through `buildBrandPatch()`**; mini-CMS/site-assets are read live (no rebuild),
   but anything baked into `brand.json` needs the cascade's `brand.json` push + a revalidate.
7. **The brand-build flow is settled** — make both ends (Eve's brief, the forge robot) brilliant;
   don't re-architect the build/refine/publish lifecycle.
8. **Never edit a brand's `main` directly** — site edits ride a `revision/<id>` branch → preview →
   approve → merge.
9. **Authed routes make no `fetch` before their DB query** (the persistent-Node/Workers constraint), and the
   app backend stays on a persistent Node host — Cloud Run (not EAS Hosting).
10. **The app palette lives in three files** (`src/constants/theme.ts`, `src/lib/studio-palette.ts`,
    `src/components/nc-screen.tsx`) — change all three together.
11. **Reuse before you build. Audit first** — most things already exist; confirm a table/route/
    "system" isn't already there before adding one (Joe's strongest, repeated correction).
12. **Every code change updates the docs it affects, in the same change** (AGENTS.md documentation
    discipline).
