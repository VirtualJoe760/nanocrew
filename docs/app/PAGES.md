# Nano Crew — Pages & Sections

Reference for every user-facing screen and major section. The app chrome follows the brand system —
cool monochrome (paper / near-black) + platinum silver, no gold (see [ARCHITECTURE.md](../architecture/ARCHITECTURE.md)).
The tab bar uses a platinum-silver tint with thin outline glyphs and an opaque (mode-aware) background.
**Individual brand storefronts keep their OWN palette** — only the app chrome is monochrome.

**Tab bar (v1, in order): `Studio` · `Design` · `Market` · `Account`** (`src/components/app-tabs.tsx`).
**Studio is the app's home.** The **social feed is hidden for v1** — its code is preserved at the
`/feed` route (`src/app/feed.tsx`) with no tab, and it returns as the lead tab in v2. Section 1 below
documents that feed as-built for when it comes back.

---

## 1. The social feed — HIDDEN for v1 (`src/app/feed.tsx`)

> **Hidden for v1.** Not in the tab bar; reachable only at the `/feed` route. The code below is
> preserved and documented for the v2 return. (This was formerly the "Nanocrew" home tab.)

TikTok-style full-screen vertical feed of published products across all brands; video-first with
photo fallback. The active card autoplays its video (looped, muted); others pause.

- **States:** loading · empty ("No drops yet — publish one in Design.") · paged snap-scroll feed.
- **Per card overlay:** `@store-slug` handle, product name (tappable), brand name + price, and a
  light **Buy** pill. Every overlay label carries a soft shadow so it stays legible over bright or
  dark product media.
- **Right-side actions** (white glyphs, safe-area clearance):
  - **Like** (♡/♥) → optimistic toggle → `POST /api/feed/:id/like`. Needs a free account; signed-out
    taps no-op gracefully.
  - **Share** (↗) → native share sheet. Shares the product's page on the **brand's real site URL**
    (`siteUrl/product/:slug`) when the brand has a live website, else a text-only message. On a
    successful share → `POST /api/feed/:id/share`.
  - **Try on** (🤳) → pick a selfie from the library → `POST /api/tryon` → modal renders the product
    on you (busy spinner → result image, or an error/sign-in prompt).
- **Quick-look modal:** tapping the product **title** opens a bottom-sheet (handle, name, brand,
  price, description). Primary **Shop @store** deep-links to that brand's in-app store on the Market
  tab (`/market?store=<slug>`); a **"View product ↗"** link opens the brand's real site URL in an
  in-app browser (shown only when the brand has a live site).
- **Buy tag** (card + quick-look) routes to `/market?store=<slug>` — the in-app brand store.
- **Calls:** `/api/feed`, `/api/feed/:id/like`, `/api/feed/:id/share`, `/api/tryon`.

## 2. Market (`src/app/market.tsx`)

Brand discovery + in-app storefronts. Fully public. Monochrome "Marketplace" eyebrow + "Market" title.

- **Search** (debounced 300ms) → `/api/market?q=` filters brands; refresh-to-reload.
- **Trending** rail (horizontal, hidden while searching): newest product shots across live shops;
  tapping one opens its brand's in-app store.
- **Brand cards:** logo, name, tagline (or drop count), product-count badge, a preview thumbnail
  strip, and a footer with **"Open store →"** (whole card opens the in-app store) plus a separate
  **"Website ↗"** pill that opens the live site (custom domain preferred) in a browser.
- **Deep link:** `/market?store=<slug>` (from the feed's Buy/Shop actions) opens that store directly.
- **Calls:** `/api/market`, then `/api/store/:slug` (via Brand Store).

### Brand Store modal (`src/components/brand-store.tsx`)
In-app storefront for one brand, painted in **that brand's own palette** (bg/text/accent hex, with
monochrome fallbacks). Full-screen slide-up `Modal`.

- **SquareCarousel hero** (`src/components/square-carousel.tsx`) above the title — OG art leads, then
  the newest product shots (deduped, up to 8).
- **Header:** logo, brand name, tagline, piece count, and (when a site exists) a **"Shop the website ↗"**
  button. A top bar carries **✕ close** and a **"visit website →"** link.
- **Collections grid:** products grouped by **collection/drop** with a season badge, two-column cards
  (image, name, price). Tapping a product opens **ProductDetail**. Empty state when a brand has no
  pieces yet.
- **Calls:** `/api/store/:slug`.

### Product detail (`src/components/product-detail.tsx`)
The in-app product page (full-screen `Modal`, brand-coloured, **← back**).

- **Image carousel** (SquareCarousel) → name → price (single variant price, or a lo–hi range).
- **Variant picker:** COLOR chips and SIZE chips driven by the variant list; picking a colour narrows
  the available sizes (unavailable sizes are dimmed/disabled); defaults to the first in-stock variant.
- **Description** (markdown text) + an inline note line for messages.
- **Buy bar** (pinned): **Buy · $price** (or "Sold out"). Buying proxies to our POS
  (`POST /api/store/:slug/checkout`) → Stripe Checkout opened in an in-app browser. Prices match the
  website — physical goods take no Apple cut, so there's no in-app markup. A `503` shows "Checkout
  isn't live yet" until payments are turned on.
- **Calls:** `/api/store/:slug/products/:productSlug`, `/api/store/:slug/checkout`.

## 3. Studio (`src/app/studio.tsx`)

The brand builder + creator home. Static silk background (`FabricBackground`), the circular **NC
nucleus** / dense JARVIS-style orb, platinum-silver accent. Header: NC mark + "STUDIO" eyebrow +
context icons (manage pencil / brands hamburger / keyboard toggle). Routes by `mode`:

- **Signed-out (intro):** NC nucleus, "INTELLIGENCE IS THE NEW FABRIC", **"Meet Venus"** title +
  blurb, **Create an account** / **log in** CTAs (→ Account tab). "Free to explore. You only need a
  plan to launch a store."
- **New creator — voice pick + CTA:** first-time creators choose an AI voice (preview each via
  `POST /api/voice` TTS) → **Get started** wakes the interview.
- **Interview:** the orb reacts to live audio (idle → listening → thinking → speaking). Tap it to
  talk (auto-listens after each reply; silence ends your turn), or toggle the **keyboard** for typed
  chat. Karaoke word-by-word subtitles sync to Venus's speech. Each turn → `POST /api/voice`
  (`audio`/`text` in → reply speech + word timings + heard text). On `done`, a **brand summary**
  appears (logo, palette swatches, vibe chips, story) → **Create my store** → `POST /api/store`. A
  `402` opens the **Paywall** (`subscription_required` or `brand_limit`); on success Venus announces
  the launch and points you to Design.
- **Dashboard (returning creator, `src/components/studio-dashboard.tsx`):** a card per brand with
  revenue/orders; **Build a new brand** relaunches the interview; **credits/plan** opens the Paywall
  in `manage` mode. Tapping a brand opens its **Console**.
- **Calls:** `/api/me`, `/api/voice`, `/api/store`, `/api/creator/{stats,credits,subscription}`.

### Brand Console (`src/components/studio-composer.tsx`)
Per-brand management sheet (opened from the dashboard or the header manage icon). Pills switch brands
when you have several. Four tabs:

- **Edit site** — if a site exists: OG-image preview (tap → in-app browser with critique), a **go-live /
  custom-domain** row (`GoLiveComposer`), **✦ Site Options** — the mini-CMS (`SiteEditor`), and **chat with
  Venus**. Two distinct paths: the **mini-CMS is direct + instant** (edit site copy / colors / fonts →
  `POST /api/creator/site-config` → `stores.site_config`, read live by the template, **no rebuild**;
  each text box has a **✦ Enhance** button — AI rewrites it in the brand voice via
  `/api/creator/enhance-copy`, free + rate-limited like `/api/enhance`).
  **Brand name** is also edited here, but it is NOT a mini-CMS field — it lives on the store record and
  is baked into the site. Saving a new name `PATCH /api/creator/stores/:slug { name }` **cascades**:
  it (1) updates `stores.name` (app updates instantly), (2) **clears the logo** (`stores.logoUrl=null`
  — the old logo baked the old name; this re-surfaces the "Add your logo" bounty + the app tells the
  creator to remake it in Design or via Venus), and (3) rewrites the site repo's **`brand.json`**
  (`name` + cleared `logoUrl`) via the GitHub contents API (`src/lib/brand-config.ts`) → Vercel
  **rebuilds** the site with the new name and no logo.
  the **Venus chat is the forge** (open-ended redesigns → preview → approve). If no site: **Build site**
  (`/api/creator/build-site`; a `402` prompts the Pro upgrade). → `/api/creator/{site-config,enhance-copy,
  revise,revisions[/:id/approve]}`.
- **Posts** — write/edit/publish/hide/delete journal posts with an optional cover image
  (`/api/creator/posts*`, `/api/creator/upload`). DB-backed, no redeploy.
- **Sell** — per-product actions with a **credits display** (taps → Paywall to top up): **on-model
  shots** (`/api/creator/model-shots`, ~20cr), **on-model film** (`/api/creator/model-videos`, ~Veo
  cost), feed **video ad** (`/api/video`, voiceover mode), and **delete** (removes the product from
  the catalog, storefront site, and Printful — see the delete-a-product loop). Plus **✦ Make a scene
  short** (`SceneShortComposer` → fal.ai, pick Wan/Seedance/Veo 3). 402s prompt a top-up.
- **Settings** — brand controls + performance. **Domain**: assign a custom domain / go live
  (`GoLiveComposer`). **Performance**: revenue, orders, 30-day views, avg margin, per-product
  margins, and recent orders with **refund** on refundable statuses. **Danger zone**: **Delete this
  brand** (confirm dialog → `DELETE /api/creator/stores/:slug`, owner-only; cascades the store →
  catalogues/designs/products/variants/orders/posts/revisions; external resources cleaned out of
  band). On delete the console closes and the dashboard refetches.
- **Calls:** `/api/creator/{stats,orders,margins,posts,revisions,products,credits,build-site,revise,
  site-config,enhance-copy,model-shots,model-videos,upload}`, `/api/creator/stores/:slug` (GET/PATCH/
  **DELETE**), `/api/creator/orders/:id/refund`, `/api/video`.

### Earnings Cockpit (`src/components/earnings-cockpit.tsx`)
All-brands business overview (opened from Account → Earnings): revenue / orders / 30-day views /
to-fulfill, per-store breakdown, recent orders, product margins.

### Paywall (`src/components/paywall.tsx`)
Opens on a store-launch `402` (Studio) or from **Account → Subscription & billing** / the Studio
credits pill (`reason="manage"`). Title/subtext adapt to the reason (`subscription_required`,
`brand_limit`, `manage`). Lists **subscription tiers** (credits/mo, brand cap, in-app store vs
website + custom domain, credit-rate discount) and **credit packs** (priced at your plan's rate).
Checkout opens **Stripe in the browser** (`/api/creator/billing/checkout`); active subscribers get a
**"Manage billing in Stripe ↗"** portal link. Reads `/api/creator/subscription`.

### Site Preview + Critique (`src/components/site-preview.tsx`)
In-app browser (back / reload / open-in-browser). On **web** the site loads in an `<iframe>`
(react-native-webview has no web build); on native it's a real WebView. **Critique mode** for the
live site: mark up the page + record a spoken critique → posts to `/api/creator/revise`
(branch-based). The pen is a **toggle** (claims the gesture at capture phase + refuses termination so
the WebView/iframe can't steal the stroke); an **undo** removes the last accidental circle. The
hit-test resolves the most SPECIFIC thing marked — a **button/link + its label** first (e.g. *the
"Shop the drop" button*), an **image** (+ its `data-nano-image` id), then the block/section/heading —
so the brief says *what* was marked, not just where. The primary proof fed to Claude is a **real
on-device annotated screenshot** (`react-native-view-shot` `captureRef` → hosted by `/revise` →
downloaded into `briefs/screenshots/`); if a build lacks that native module, the forge falls back to
re-rendering the strokes (Playwright/Chromium). The mark can be any shape (circle, arrow, scribble).

**Preview-ready push:** the forge **worker** (which marks revisions/provisions ready on the box)
push-notifies the creator on **ready** and on **failed** (Expo push to their `device_tokens`) — so
they're told when a preview lands or an edit didn't take, instead of watching "building…". (The
older `src/lib/notify.ts` path only covered the in-app synchronous revise.)

## 4. Design (`src/app/design.tsx`)

AI product designer — a zoomable canvas (the proven stephen-lawyer create→design→Printful loop). Auth
required; signed-out shows a graceful sign-in prompt rather than the canvas.

- **Setup popup (first thing on the tab):** pick the **brand** you're designing for, then **what
  for** — either **🌐 Site assets** (the brand's website: hero / logo / social — **no collection
  needed**) or a **collection** (products). One brand → it's pre-selected and you land on the
  second step. The top-left chip (`BRAND · Site assets` or `BRAND · COLLECTION ▾`) reopens it to
  switch. Catalogues are brand-scoped (`/api/catalogues?store=<slug>`, access-checked).
  - **Site assets mode** (`assetMode`): brand-level, catalogue-free. Site-asset slots resolve by
    `storeSlug` (the `/api/creator/site-assets` endpoint accepts either `catalogueId` *or*
    `storeSlug`); `cover` is the one slot that still needs a collection (it's a collection cover).
    The dock opens straight to **Web assets**; the canvas isn't persisted (assets save on the store
    when assigned). Picking/creating a collection exits the mode.
- **Top bar:** the brand·collection chip + design-history strip.
- **Canvas:** node kinds — `design`, `template` (blank garment), `composition` (design-on-garment),
  `webslot` (a website-asset target), `group`. Pan/zoom, tap, box-select, blend. Auto-saves to
  `/api/canvas/:catalogueId`.
- **Generate (FAB):** prompt or image, aspect ratio, transparent/filled, effort → `/api/generate`
  (Nano Banana; magenta chroma-key for transparency).
- **Compose:** drag a design onto a blank → `/api/compositions` → `/api/composite`; **PlacementEditor**
  sizes/positions it and renders **real Printful mockups** (`/api/mockup`); **FinalizeSheet** sets
  name/collection/sizes/colors and publishes (`/api/publish`, with the cost+$5 price floor enforced).
- **Blend / Combine:** merge two designs (`/api/merge`) or pick placements for a design+product.
- **Catalogues/drops:** create with season presets, scoped to the chosen brand (`/api/catalogues`).
- **Dock (3 panels):** **Products** (the full Printful catalogue — `/api/blanks`, `/api/blank/:id/*`),
  **Web assets** (the site's slots: hero / cover / logo), **Content**.
- **Web assets:** drag a graphic onto a web-slot target → it "clicks together," assigns to the brand
  site (`/api/creator/site-assets` — a direct DB write to `stores.site_assets`), and the finished
  group then **clears off the canvas** (the asset is saved; nothing lingers). Slots that haven't been
  filled stay; finished ones are also stripped on load.

## 5. Account (`src/app/account.tsx`)

Auth + account, recently reworked into an iOS-settings-style grouped list. Monochrome "ACCOUNT" eyebrow.

**Signed-in:**
- **Profile header** — avatar (OAuth picture or an initial fallback), email, a **plan badge**
  (Free/Starter/Pro/Advanced), and a short `creator <id>`.
- **Your brands** card — a row per store (name, slug · status) → opens that brand's in-app **Brand
  Store**, or an empty "No brands yet" row.
- **Commerce** card — **Earnings** → EarningsCockpit (shown when you have stores); **Subscription &
  billing** → opens the **Paywall** (`manage`); **Payouts** → Stripe Connect onboarding
  (`/api/creator/connect`), label adapts to connected/charges-enabled state.
- **Platform** card — **Platform admin** (`PlatformAdmin`), only when the account is a platform admin.
- **Danger zone** — **Sign out** + **Delete account** (confirm dialog → `DELETE /api/me`).
- **Footer** — **Privacy · Terms** links (`nanocrew-api.vercel.app/privacy` + `/terms`).

**Signed-out — "Join the crew":**
- **Continue with Apple** (native Sign in with Apple, iOS only, shown first per Apple's rule).
- **Continue with Google** (OAuth).
- **Email + password** sign in / create account.
- *(Facebook was removed for v1.)*

- **Calls:** `/api/me`, `/api/platform/admin`, `/api/creator/{connect,subscription}`; Supabase Auth
  for email/OAuth.
