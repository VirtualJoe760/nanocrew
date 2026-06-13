# Nanocrew — Pages & Sections

Reference for every user-facing screen and major section. Five tabs (`src/app/*.tsx`) plus the
Studio modals (`src/components/*`). Theming follows the brand system (monochrome + champagne gold;
see [ARCHITECTURE.md](ARCHITECTURE.md)).

---

## 1. Nanocrew — the feed (`src/app/index.tsx`)

TikTok-style full-screen vertical feed of published products across all brands; video-first with
photo fallback.

- **States:** loading · empty ("No drops yet — publish one in Design") · paged feed (snap scroll).
- **Per card:** active card autoplays its video (muted); product handle, name, price, brand.
- **Right-side actions** (gold-accented, fixed for safe-area clearance):
  - **Like** (♡/♥, gold when liked) → `POST /api/feed/:id/like` (optimistic; needs an account).
  - **Share** (↗) → native share sheet → `POST /api/feed/:id/share`.
  - **Try on** (🤳) → pick a selfie → `POST /api/tryon` → modal renders the product on you.
- **Auth/gating:** browse freely; like/share/try-on need a free account (signed-out taps no-op).
- **Calls:** `/api/feed`, `/api/feed/:id/like`, `/api/feed/:id/share`, `/api/tryon`.

## 2. Market (`src/app/market.tsx`)

Brand discovery + in-app storefronts. Fully public.

- **Search** (debounced 300ms) → `/api/market?q=` filters brands by name/slug/tagline.
- **Trending** rail (when not searching): newest products across live shops.
- **Brand cards:** logo, name, tagline/drop count, preview strip; **gold "Visit"** opens the
  brand's website. Tapping a card (or a trending item) opens the **Brand Store** modal.
- **Calls:** `/api/market`, then `/api/store/:slug` (Brand Store).

### Brand Store modal (`src/components/brand-store.tsx`)
In-app storefront for one brand, painted in **that brand's own palette**. Header (logo, name,
tagline, piece count), products grouped by **collection/drop** with season badges, prices.
"Visit website →" opens the live site; tapping a product opens the site (or stays browse-only).

## 3. Studio (`src/app/studio.tsx`)

The brand builder + creator home. Brand look: static black silk background, circular **NC nucleus**,
champagne gold. Header shows the NC mark + manage/metrics/keyboard icons. Routes by state:

- **Signed-out:** NC nucleus, "Intelligence is the new fabric", "Meet Venus", create-account/login.
- **New creator (CTA):** pick an AI voice (preview via `/api/voice` TTS) → **Get started**.
- **Interview:** the NC nucleus reacts to live audio (idle → listening → thinking → speaking).
  Tap it to talk; or toggle the keyboard for **typed** chat. Karaoke subtitles sync to speech.
  Each turn → `POST /api/voice` (`audio`/`text` in → reply speech + word timings). On `done`,
  a **brand summary** appears (logo, palette swatches, vibe chips, story) → **Create my store** →
  `POST /api/store`. A `402` opens the **Paywall**; success announces the launch.
- **Dashboard (returning creator):** small Venus + a card per brand (auto-advancing OG/product
  carousel, revenue + orders), **credits/plan pill** (→ Paywall in manage mode), **"Build a new
  brand"** (relaunches the voice/typed interview). Tapping a brand opens its **Console**.
- **Calls:** `/api/me`, `/api/voice`, `/api/store`, `/api/creator/{stats,credits,subscription}`.

### Brand Console (`src/components/studio-composer.tsx`)
Per-brand management modal opened by tapping a brand. Four tabs:

- **Edit site** — OG-image preview (tap → in-app browser). If no site: **Build site**
  (`/api/creator/build-site`). If a site exists: **chat with Venus** — your change requests as
  bubbles, her status replies (building / ready-to-review / published) with review + publish
  actions, and a composer. → `/api/creator/revise`, `/api/creator/revisions[/:id/approve]`.
- **Posts** — write/edit/publish/delete journal posts (`/api/creator/posts*`). Publishing is
  instant (DB-backed, no redeploy).
- **Sell** — per-product "create video ad" (`/api/video`, voiceover mode), credit cost shown,
  402 → top-up. Lists `/api/creator/products`.
- **Insights** — this brand's revenue, orders, 30-day views, avg margin, per-product margins,
  recent orders (`/api/creator/{stats,margins,orders}`).

### Earnings Cockpit (`src/components/earnings-cockpit.tsx`)
All-brands business overview (bar-chart header icon): revenue / orders / 30-day views / to-fulfill,
per-store breakdown, recent orders, product margins. (Overlaps the Console's per-brand Insights.)

### Paywall (`src/components/paywall.tsx`)
Opens on a store-launch `402` or from the credits pill. Shows subscription tiers
($10/$49/$199) + one-time credit packs; checkout opens Stripe in the browser
(`/api/creator/billing/checkout`). Reads `/api/creator/subscription`.

### Site Preview + Critique (`src/components/site-preview.tsx`)
In-app browser (back / reload / open-in-browser; clears the Dynamic Island). **Critique mode**
(pen icon, for the live site): draw gold marks on the page **and** record a spoken critique;
**Send** transcribes (`/api/transcribe`) and posts the critique + marked regions + page URL to
`/api/creator/revise` (branch-based). *Note: the actual annotated screenshot image needs a dev
build (`react-native-view-shot`); today Claude gets the spoken critique + region labels.*

## 4. Design (`src/app/design.tsx`)

AI product designer — a zoomable canvas (the proven stephen-lawyer loop). Auth required; the ✦
mark is gold.

- **Top bar:** catalogue switcher (gold chip) + design-history strip.
- **Canvas:** node kinds — `design`, `template` (blank), `composition` (design-on-garment),
  `group`. Pan/zoom, tap, box-select, blend. Auto-saves to `/api/canvas/:catalogueId`.
- **Generate (FAB):** prompt or image, aspect ratio, transparent/filled, effort → `/api/generate`
  (Nano Banana).
- **Compose:** drag a design onto a blank → `/api/compositions` → `/api/composite` (review render);
  **PlacementEditor** sizes/positions it and renders **real Printful mockups** (`/api/mockup`);
  **FinalizeSheet** sets name/collection/sizes/colors and publishes (`/api/publish`).
- **Blend / Combine:** merge two designs (`/api/merge`) or pick placements for a design+product.
- **Catalogues/drops:** create with season presets (`/api/catalogues`).
- **Templates dock:** the full Printful catalogue (`/api/blanks`, `/api/blank/:id/*`).

## 5. Account (`src/app/account.tsx`)

Auth + account. Gold "Account" eyebrow.
- **Signed-out:** Google / Facebook OAuth + email-password (sign in / create account).
- **Signed-in:** email + creator id, your stores, **Subscription & billing** (web portal link),
  sign out.
- **Calls:** `/api/me`.
