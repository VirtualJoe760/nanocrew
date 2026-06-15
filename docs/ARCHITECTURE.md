# Nanocrew — Architecture

Nanocrew is an AI-native creator commerce platform: a creator talks to **Venus** (voice/typed
AI) to define a clothing brand, and the system auto-generates a Printful-backed shop **and** a
per-brand storefront website. This document is the system map. See also
[DATABASE_PLAN.md](DATABASE_PLAN.md), [STOREFRONT_ENGINE.md](STOREFRONT_ENGINE.md) (provisioning
detail), [STOREFRONT_DATA_CONTRACT.md](STOREFRONT_DATA_CONTRACT.md) (catalogue data flow),
[PAGES.md](PAGES.md), [API.md](API.md), [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md),
[REMAINING_FEATURES.md](REMAINING_FEATURES.md).

## The four deployable units

| Unit | What | Where it runs |
|---|---|---|
| **Mobile app** | Expo / React Native app (the product). Its `src/app/api/**+api.ts` server routes hold the authenticated creator logic. | **Railway** — `backend-production-d7eb.up.railway.app`, a persistent Node server (`expo serve`). Native build (prod) / Metro (dev) for the client; `EXPO_PUBLIC_API_URL` points at Railway. **Not EAS Hosting** (see below). |
| **platform-api** | Public Next.js API consumed by the storefront websites + webhooks (checkout, Stripe, Printful). | Vercel — `nanocrew-api.vercel.app` (rootDirectory `platform-api/`) |
| **nanocrew-templates** | Sibling repo of 4 self-contained Next.js storefront templates (minimal / bold / elegant / extravagant). One `brand.json` token file turns a template into a brand. | GitHub source; each brand → its own Vercel project |
| **forge** | DigitalOcean droplet running headless Claude. A systemd **`nanocrew-forge-worker`** drains the revision queue and provisions/revises brand websites locally. | VPS (`ssh nanocrew-forge`) |

All four share **one Supabase Postgres** (Drizzle ORM). `platform-api/db/schema.ts` is a **copy**
of `src/db/schema.ts` — keep them in sync on every migration.

### Why the app backend is on Railway, not EAS Hosting

EAS Hosting runs on Cloudflare Workers. Opening a postgres-js **TCP** socket there is unreliable
across requests — and worse, opening one *after* an outbound `fetch()` in the same request
reliably fails, which broke every authed DB route. The backend therefore runs on Railway as a
persistent Node process (`expo serve`), where a normal connection pool survives between requests
(`src/lib/db.ts`, Supabase transaction pooler, `prepare: false`). **Do not move it back.** Railway
**GitHub auto-deploy is live** — push to `main` → deploy.

Two more workarounds stem from `expo serve`'s per-request isolation:
- **Cloudinary** uploads go through the **signed REST API** (`src/lib/cloudinary.ts`), not the
  `cloudinary` SDK — the SDK's `upload_stream` silently fails in that runtime. File is sent as a
  base64 data URI over `application/x-www-form-urlencoded` (no FormData/Blob).
- **Cross-request caches** (e.g. TTS) are stored as Cloudinary `raw` blobs and re-fetched by URL.

## Auth

`src/lib/auth.ts` `getUserFromRequest()` verifies the Supabase access token **locally** — no
per-request network call. It checks the **ES256** signature against the project JWKS (read from the
`SUPABASE_JWKS` env, so there's zero I/O in the hot path; falls back to fetching the JWKS once,
cached, if unset). It pins `alg=ES256`, requires `aud=authenticated`, checks `exp` and issuer. This
matters because authed routes must make no `fetch` before their DB query (see the Railway/Workers
note above). There's also a **server-to-server bypass**: a request carrying a valid `x-internal-key`
(constant-time compared against `INTERNAL_API_KEY`) plus `x-internal-creator` authenticates AS that
creator — used by `AUTO_FIRST_DROP` generation, which calls the now-authed designer routes.

Authed client calls use `apiFetch()` (`src/lib/api.ts`, attaches the Supabase token). Designer +
creator endpoints are per-creator scoped (`src/lib/tenant.ts`); paid AI endpoints are credit-gated
(`src/lib/credits.ts`) and rate-limited (`src/lib/rate-limit.ts`).

## End-to-end flow

```
Studio interview (Venus, voice/typed)
   → BrandResult (name, tagline, palette, voice, story, products)
   → POST /api/store  (canLaunchStore gate: paid plan + brand cap)
       → generate logo (Gemini 2.5 Flash Image) + OG image (Cloudinary transform)
       → create store row + first catalogue
       → ensureConnectedAccount() (Stripe Connect, best-effort)
       → if Pro+ (website): provisionStorefront()  ── enqueues, NO SSH ──┐
       └→ (AUTO_FIRST_DROP=1) generateFirstDrop() → products             │
                                                                         ▼
   provisionStorefront() (src/lib/provision.ts):                  store_revisions queue
     • creates the per-brand GitHub repo (store-<slug>)            (branch '__provision__')
     • builds brand.json + briefs/01-BRAND.md + 02-TEST.md                │
     • INSERTs a store_revisions row (branch '__provision__', building)   │
   forge-worker (systemd, on the droplet) drains it ◄─────────────────────┘
     • sparse-clones the chosen template, writes brand.json + briefs
     • headless `claude -p` applies the brand, build-gate (pnpm run build)
     • pushes to main → creates Vercel project + production deploy
     • flips store → 'ready' with deployment_url

Designer (Design tab) → /api/generate → /api/compositions → /api/mockup → /api/publish
   → live Printful sync product + local products/variants → appears on feed + shop + site
   → revalidateStorefront(slug) redeploys the brand's Vercel project (also on product delete)

Site edits: creator critiques in-app (chat or draw+voice) → /api/creator/revise
   → ENQUEUES a store_revisions row (revision/<id> branch) → forge-worker applies on that
     branch → Vercel preview → creator approves → /api/creator/revisions/:id/approve
     → branch merges to main (GitHub API) → production

Commerce: storefront → platform-api /public/checkout → Stripe → stripe-webhook
   → order paid → submit to Printful → printful-webhook → tracking
```

### Provisioning & revisions are queue-based (no SSH)

The app server **never SSHes the forge** (it can't from a managed host). `provisionStorefront()`
does the cheap GitHub-API + brief-building work on the app server, then **enqueues** a job into the
`store_revisions` table — provisioning uses the reserved branch `'__provision__'`, revisions use
`revision/<id>`. The single `nanocrew-forge-worker` (one job at a time, global `~/stores/.forge.lock`)
polls that table and runs the heavy clone→brand→build→push→Vercel pipeline **locally** on the droplet
(`forge-worker/worker.mjs`, which mirrors `src/lib/revise.ts` / `src/lib/provision.ts`). This makes
the 30-min build independent of the app server staying alive. Pro+ only: Starter brands sell in-app
(feed / Market / in-app store) with no website.

### Storefront freshness

Template storefronts read `platform-api` at build/ISR time, so a catalogue change leaves the live
site stale until it rebuilds. `src/lib/storefront-revalidate.ts` `revalidateStorefront(slug)`
fire-and-forget redeploys the brand's Vercel project (tries both `<slug>` and `store-<slug>` project
names). Wired into `/api/publish` and product delete (`/api/creator/products/[id]`).

## Server-side libraries (`src/lib/`)

| Lib | Purpose |
|---|---|
| `db.ts` | Supabase Postgres via Drizzle + postgres-js (server-only; persistent pool on Railway, `prepare: false`). |
| `auth.ts` | `getUserFromRequest()` — local ES256 JWKS verification + constant-time internal-key bypass. |
| `tenant.ts` / `api.ts` | Per-creator scoping helpers · authed client `apiFetch()`. |
| `interview.ts` | The brand-interview brain (shared by `/api/voice` + `/api/interview`) → `BrandResult`. |
| `voices.ts` | AI consultant roster + ElevenLabs voice IDs. |
| `provision.ts` | Storefront provisioning — repo + brand.json + briefs, then **enqueues** a `'__provision__'` job. |
| `revise.ts` | Branch-based site revision recipe (mirrored by the forge worker). |
| `storefront-revalidate.ts` | Redeploy a brand's Vercel project after a catalogue change. |
| `first-drop.ts` | `generateFirstDrop()` — Gemini-invented first products (gated by `AUTO_FIRST_DROP`). |
| `printful.ts` | Printful REST client (catalog, mockups, sync products, orders, cost). |
| `cloudinary.ts` | Signed-REST media hosting (designs, videos, mockups, raw cache) — no SDK. |
| `transparency.ts` | Pure-JS magenta chroma-key (Nano Banana can't emit alpha; no native deps). |
| `og-image.ts` | Brand OG / avatar card (logo + tagline) as a Cloudinary transform. |
| `model-shots.ts` / `model-video.ts` / `veo.ts` / `scene-video.ts` / `fal-video.ts` / `voiceover-ad.ts` | On-model imagery + product/scene video (Veo 3, fal.ai tiers) + cheap VO ads. |
| `pricing.ts` | Single-source retail price from `variants.retailPriceCents` with a cost+$5 floor. |
| `billing.ts` | Subscription tiers + entitlements + `canLaunchStore()` + Stripe Checkout (REST). |
| `connect.ts` | Stripe Connect — one Express account per creator; storefront checkouts route via destination charges. |
| `domains.ts` | Custom-domain attach (Vercel + credits). |
| `credits.ts` | Credit metering (debit/grant/balance + signup bonus). |
| `rate-limit.ts` | Per-creator rate limiting on paid AI endpoints. |
| `safe-fetch.ts` | SSRF guard for outbound fetches of creator-supplied URLs. |
| `iap.ts` / `iap-products.ts` | Apple IAP client seam (off until a dev build) + product catalogue. |
| `push.ts` / `notify.ts` | Push-token registration (`expo-notifications`) + server delivery via Expo. |
| `oauth.ts` | Native Sign in with Apple (`signInWithIdToken`). |
| `posts.ts` / `adapt.ts` / `effort.ts` | Feed posts · content adaptation · effort/spend helpers. |
| `studio-palette.ts` | Theme-aware monochrome + platinum-silver palette for the Studio modals. |
| `supabase.ts` | Supabase client. |

## Brand design system

Cool monochrome (warm paper / near-pure black) + a single **platinum-silver** metallic accent (the
Nano Crew asset sheet — "depth, dimension, sophistication"; **no gold**), clean sans (General Sans),
serif reserved for the NC monogram. **Three palette sources** must stay aligned:
`src/constants/theme.ts` `Colors` (app-wide), `src/lib/studio-palette.ts` (Studio modals),
`src/app/studio.tsx` `makePalette` (the Studio screen). Only the app chrome is monochrome —
individual brand storefronts keep their own brand colors.

## Data model

Full table list in [DATABASE_PLAN.md](DATABASE_PLAN.md) and `src/db/schema.ts`. Tenancy root is
`creators → stores`; everything is `store_id`-scoped. Key groups: design (`catalogues`, `designs`,
`compositions`, `canvasNodes`), commerce (`products`, `variants`, `orders`, `orderItems`,
`pageViews`), content (`storePosts`), social (`productLikes`), billing (`subscriptions`,
`connectedAccounts`, `creditAccounts`, `creditLedger`), site editing (`storeRevisions` — also the
provisioning/revision job queue the forge worker drains), and notifications (`deviceTokens`).
