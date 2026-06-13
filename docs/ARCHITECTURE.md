# Nanocrew — Architecture

Nanocrew is an AI-native creator commerce platform: a creator talks to **Venus** (voice/typed
AI) to define a clothing brand, and the system auto-generates a Printful-backed shop **and** a
per-brand storefront website. This document is the system map. See also
[DATABASE_PLAN.md](DATABASE_PLAN.md), [STOREFRONT_ENGINE.md](STOREFRONT_ENGINE.md),
[PAGES.md](PAGES.md), [API.md](API.md), [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md),
[REMAINING_FEATURES.md](REMAINING_FEATURES.md).

## The four deployable units

| Unit | What | Where it runs |
|---|---|---|
| **Mobile app** | Expo / React Native app (the product). Its `src/app/api/**+api.ts` server routes run on the Metro/Expo server and hold the authenticated creator logic. | Expo Go (dev) / native build (prod) + an app server |
| **platform-api** | Public Next.js API consumed by the storefront websites + webhooks. | Vercel — `nanocrew-api.vercel.app` (rootDirectory `platform-api/`) |
| **nanocrew-templates** | Monorepo of 4 self-contained Next.js storefront templates (minimal / bold / elegant / extravagant). One `brand.json` token file turns a template into a brand. | GitHub source; each brand → its own Vercel project |
| **forge** | DigitalOcean droplet running headless Claude. Provisions + revises brand websites on working branches. | VPS (`64.23.147.121`, `ssh nanocrew-forge`) |

All four share **one Supabase Postgres** (Drizzle ORM). `platform-api/db/schema.ts` is a **copy**
of `src/db/schema.ts` — keep them in sync on every migration.

## End-to-end flow

```
Studio interview (Venus, voice/typed)
   → BrandResult (name, tagline, palette, voice, story, products)
   → POST /api/store  (billing-gated)
       → generate logo (Nano Banana) + OG image (Cloudinary)
       → create store + first catalogue
       → provisionStorefront()  ──► forge: clone template, write brand.json + briefs,
       │                              headless Claude applies brand, build-gate, push
       │                          ──► Vercel: project + deploy → <slug>.vercel.app
       └→ (AUTO_FIRST_DROP=1) generateFirstDrop() → products

Designer (Design tab) → /api/generate → /api/compositions → /api/mockup → /api/publish
   → live Printful sync product + local products/variants → appears on feed + shop + site

Site edits: creator critiques in-app (chat or draw+voice) → /api/creator/revise
   → forge applies on revision/<id> branch → Vercel preview → creator approves
   → /api/creator/revisions/:id/approve → branch merges to main → production

Commerce: storefront → platform-api /public/checkout → Stripe → stripe-webhook
   → order paid → submit to Printful → printful-webhook → tracking
```

## Server-side libraries (`src/lib/`)

| Lib | Purpose |
|---|---|
| `db.ts` | Supabase Postgres via Drizzle + postgres-js (server-only). |
| `auth.ts` | `getUserFromRequest()` — validates the Supabase bearer token. |
| `interview.ts` | The brand-interview brain (shared by `/api/voice` + `/api/interview`) → `BrandResult`. |
| `voices.ts` | AI consultant roster + ElevenLabs voice IDs. |
| `provision.ts` | Storefront provisioning (template pick → GitHub repo → forge → Vercel). |
| `revise.ts` | Branch-based site revision loop (request + screenshots → Claude on a branch → preview → approve → merge). |
| `first-drop.ts` | `generateFirstDrop()` — Gemini-invented first products (gated by `AUTO_FIRST_DROP`). |
| `printful.ts` | Printful REST client (catalog, mockups, sync products, orders, cost). |
| `cloudinary.ts` | Media hosting (designs, videos, mockups). |
| `transparency.ts` | Pure-JS magenta chroma-key (Nano Banana can't emit alpha; no native deps). |
| `og-image.ts` | Brand OG / avatar card (logo + tagline) as a Cloudinary transform. |
| `veo.ts` | Veo 3 product videos (premium, cached on the product row). |
| `voiceover-ad.ts` | Cheap ad: product image Ken-Burns + ElevenLabs VO + ffmpeg → 9:16 mp4. |
| `billing.ts` | Subscription tiers + entitlements + `canLaunchStore()` + Stripe Checkout (REST). |
| `credits.ts` | Credit metering (debit/grant/balance + signup bonus). |
| `iap.ts` / `iap-products.ts` | Apple IAP client seam (disabled until a dev build) + product catalogue. |
| `push.ts` / `notify.ts` | Push-token registration seam (disabled until a dev build) + server delivery via Expo. |
| `studio-palette.ts` | Theme-aware palette (monochrome + champagne gold) for the Studio modals. |

## Brand design system

Monochrome (warm paper / near-black) + a single champagne-gold accent, clean sans with serif
reserved for the NC monogram. **Three palette sources** must stay aligned: `src/constants/theme.ts`
`Colors` (app-wide), `src/lib/studio-palette.ts` (Studio modals), `src/app/studio.tsx` `makePalette`
(the Studio screen). The Studio screen uses a static silk-wave background + the circular NC nucleus
(the old animated orb is kept as dead code for a future richer version).

## Data model

Full table list in [DATABASE_PLAN.md](DATABASE_PLAN.md) and `src/db/schema.ts`. Tenancy root is
`creators → stores`; everything is `store_id`-scoped. Key groups: design (`catalogues`, `designs`,
`compositions`, `canvasNodes`), commerce (`products`, `variants`, `orders`, `orderItems`,
`pageViews`), content (`storePosts`), social (`productLikes`), billing (`subscriptions`,
`connectedAccounts`, `creditAccounts`, `creditLedger`), site editing (`storeRevisions`), and
notifications (`deviceTokens`).
