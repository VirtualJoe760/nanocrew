# Nano Crew — Pages & Sections

Reference for every user-facing screen and major section. The app chrome follows the brand system —
cool monochrome (paper / near-black) + platinum silver, no gold (see [ARCHITECTURE.md](../architecture/ARCHITECTURE.md)).
The tab bar is FROSTED GLASS (2026-08-18): a floating translucent bar — expo-blur + a slight
mode-aware tint — with content scrolling beneath it; platinum-silver tint, thin outline glyphs.
Screens clear it with `BottomTabInset` (+ their own safe-area inset).
**Individual brand storefronts keep their OWN palette** — only the app chrome is monochrome.

**Tab bar (v1, in order): `Eve` · `Design` · `Market` · `Account`** (`src/components/app-tabs.tsx`;
the `studio` route is the Eve page — **the app's home**). The **social feed is hidden for v1** — its code is preserved at the
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

Brand discovery + in-app storefronts. Fully public. A tabbed browser — monochrome "MARKET" eyebrow +
"Discover" title, then a tab nav: **Discover · Shop · Brands** (+ **My stores** for signed-in
creators). Searching hides the tabs and shows compact brand rows.

- **Search** (debounced 300ms) → `/api/market?q=` filters brands; refresh-to-reload.
- **Discover** tab: a full-bleed paged **featured hero**, a **"Fresh drops"** collections rail, and
  a **"New this week"** 2-up product grid. All cards open the BrandStore sheet; product tiles
  deep-open the product inside it (`initialProductSlug`).
- **Shop** tab: a category-chip-filtered product grid.
- **Brands** tab: the directory grid of **brand tiles** (`BrandTile`) — a preview shot + logo +
  piece count; the whole tile opens the in-app store. (No website pill on the card — the website
  links live inside the BrandStore sheet: "visit website →" / "Shop the website ↗".)
- **My stores** (signed-in creators only, 2026-08-18): their OWN marketplace — every owned store with
  its products (including hidden ones, dimmed with a HIDDEN badge; `/api/creator/products?storeSlug=`).
  Tap a tile to open the store as shoppers see it; **long-press → Hide from store / Show in store /
  Remove for good** (`PATCH|DELETE /api/creator/products/:id`).
- **Deep link:** `/market?store=<slug>` (from the feed's Buy/Shop actions) opens that store directly.
- **Calls:** `/api/market`, then `/api/store/:slug` (via Brand Store).

### Brand Store modal (`src/components/brand-store.tsx`)
In-app storefront for one brand, painted in **that brand's own palette** (bg/text/accent hex, with
monochrome fallbacks). Full-screen slide-up `Modal`.

- **SquareCarousel hero** (`src/components/square-carousel.tsx`) above the title — product shots
  lead (deduped, up to 8); the OG card appears only when the brand has no product imagery yet.
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

## 3. The Eve tab (`src/app/studio.tsx`)

The app's home — Eve's page (tab label **Eve**; the route is still `studio`). No screen chrome of
its own: the container is transparent, so the **persistent root Eve avatar** (mounted app-wide via
`src/components/eve/eve-background.tsx`) glows through. The default surface is **EveHome**
(`src/components/eve/eve-home.tsx`). A **long-press summons the Eve wheel**
(`src/components/eve/eve-wheel.tsx`) — a radial menu of spokes (Talk · Type instead · New brand ·
New design · Your brands · Edit your site · Site assets · Digest · Brand info; brand-scoped spokes
dim until the creator has a brand). The **BrandDeck opens only from the wheel's BRANDS spoke** —
the old top-edge pull-down/handle is gone (2026-08-17). A quick tap still toggles her between
silent and talking.

**She arrives SILENT, and only a creator starts her.** Two states — `silent` and `talking` — with a
tap anywhere on her surface (or on the state pill, top-right at the safe-area inset) moving between
them. Landing on the tab opens no socket, sends no greeting, and does not even ask for the
microphone; the mic is requested on the first tap. At rest she sits under a light 30% scrim that
lifts when she talks, so the state change reads as her brightening rather than as a label.

**Covered ≠ stopped.** `EveHome` takes a `covered` prop — the ONE signal that something is layered
over her (the brand deck, the Brand Console, the Paywall, the Welcome modal). Covered or
backgrounded → the session **suspends**: muted both ways, socket held for `SUSPEND_GRACE_MS`
(45s, `src/hooks/use-live-voice.ts`), transcript intact, then released if the grace expires. So a
glance at a brand costs nothing and she picks up mid-thread instead of reconnecting and re-greeting.
A socket re-opened under an ongoing conversation passes `greetOnOpen: false`, so she never
re-introduces herself (`src/lib/live-voice.ts`).

- **First-launch Welcome (`src/components/welcome.tsx`):** a full-screen modal carousel (Eve ·
  Design · Market slides, real device captures) ending in three choices — **subscribe** (plan
  picker; after sign-in the Paywall opens, and when it closes with a paid plan active,
  `POST /api/creator/onboarding` claims the welcome-credit grant), **login**, or **shop & browse
  for free** (→ Market). Seen-flag + chosen intent persist in AsyncStorage, so it shows once.
- **Auth restore holds the ground (2026-08-18):** `session` is null while the stored session
  rehydrates, so the signed-out gate used to win the first frame of every cold start — a
  "Create an account" flash for signed-in creators. Both `studio.tsx` and `EveHome` now check
  `loading` FIRST and render the quiet dark ground until auth resolves.
- **Signed-out (intro):** EveGlyph, "FROM IDEA TO BRAND IN SECONDS", **"Meet Eve"** title + blurb,
  **Create an account** / **log in** CTAs (→ Account tab). "Free to explore. You only need a
  plan to launch a store."
- **EveHome — guide view (default):** the caption block sits in the **lower third** — "Tap to talk
  to Eve" while silent, her live transcript once talking (and an explicit "Eve can't hear you" if
  the mic was denied, which routes into the typed path rather than dead-ending) — plus the
  **digest** — Eve's status report over your real numbers (`buildDigest` /
  `digestBriefing` in `src/lib/eve-digest.ts`, fed by `/api/creator/stats`). Each spoken turn is
  distilled through the intent router (`/api/eve/route`), which routes her to her other surfaces;
  mid-conversation she can also **see** images (`sendImage` via `src/lib/eve-vision-bus.ts`).
- **EveHome — interview:** a realtime **Gemini Live** session — open-mic, Eve listens + replies
  continuously (idle → listening → thinking → speaking on the orb); tap the orb to pause/resume, or
  toggle the **keyboard** to type into the same session. The streaming transcript drives the
  captions. When she's gathered enough, the `BrandResult` is extracted (`/api/extract-brand`) → the
  **BrandReview** summary → **Create my store** → `POST /api/store`. A `402` opens the **Paywall**
  (`subscription_required` or `brand_limit`); on success Eve announces the launch in her real voice
  via a speak-only live session (`announce()` in `src/lib/live-voice.ts` — `/api/say`'s one-shot TTS
  rendered the same voice name as a different-sounding person) and points you to Design.
- **BrandDeck (`src/components/eve/brand-deck.tsx`):** opens from the wheel's BRANDS spoke and
  cross-dissolves over Eve (replaces the old dashboard — `studio-dashboard.tsx` is deleted).
  **The deck IS the console** (the merge, 2026-08-17): the overview shows the brand banner
  (tap → EveDeveloping), a forge revision-status row (building → failed / **Review**),
  **✦ Site Options** → the `SiteEditor` mini-CMS, and **FINISH YOUR SITE** bounties (→ Design);
  **Posts / Settings** pills embed the `StudioComposer` console inline; the last page builds a new
  brand. (Billing lives in Account → Subscription & billing, not in the deck.) Only offered once
  the creator has a brand.
- **EveDeveloping (`src/components/eve/eve-developing.tsx`):** the DEEP voice surface for site
  edits (the `developing` state) — swaps in full-screen over everything; on submit it opens the
  BrandDeck on that brand, where the revision-status row shows building → Review.
- **EveDesign (`src/components/eve/eve-design.tsx`):** the design popup Eve **spawns over her own
  screen** — a translucent overlay ON TOP of EveHome (deliberately NOT a screen swap: EveHome stays
  mounted, so her mic keeps listening while you talk about the design); she finishes the whole flow
  in place — ProductPicker → generate → PlacementEditor → FinalizeSheet → publish, all composed from
  the shared `src/components/designer/` seam. No hand-off to the Design tab, ever.
- **Calls:** `/api/me`, `/api/voice-live-token`, `/api/eve/route`, `/api/extract-brand`,
  `/api/store`, `/api/creator/{stats,subscription,onboarding}`.

### Brand Console (`src/components/studio-composer.tsx`)
Per-brand management, embedded INLINE in the BrandDeck (opened from its **Posts / Settings** pills,
or by a "changes ready" push deep-link). Swiping the deck's pager switches brands; the pills switch
tabs. Two tabs — **Posts · Settings** — plus the deck **overview**, which absorbed the old Edit-site
tab (Sell was removed, to be rebuilt later):

- **Overview (on the deck, not a tab)** — the Edit-site content re-homed: the brand banner (tap →
  **EveDeveloping**, the voice-edit surface), the forge **revision-status row**, and **✦ Site
  Options** — the mini-CMS (`SiteEditor`). Two distinct paths: the **mini-CMS is direct + instant**
  (edit site copy / colors / fonts →
  `POST /api/creator/site-config` → `stores.site_config`, read live by the template, **no rebuild**;
  each text box has a **✦ Enhance** button — AI rewrites it in the brand voice via
  `/api/creator/enhance-copy`, free + rate-limited like `/api/enhance`).
  **Brand name / tagline / story** are also edited here, but they are NOT mini-CMS fields — they're the
  brand's IDENTITY and live in multiple places. `PATCH /api/creator/stores/:slug { name?, tagline?,
  descriptionMd? }` runs ONE unified cascade (`src/lib/brand-identity.ts` `buildBrandPatch()` — the
  single source of truth) so an edit propagates to every surface instead of drifting:
  - `stores` columns (name, tagline, description_md) + **`brand_profile`** jsonb (the AI ground-truth read
    by enhance-copy / build-site) + the mini-CMS **`site_config.copy`** overrides (which WIN on the live
    site, so they must track) + the baked **`brand.json`** (header + SEO/meta/JSON-LD) via the GitHub
    contents API (`src/lib/brand-config.ts`) → Vercel rebuild.
  - On a **rename**, the old name is swapped → new everywhere it's embedded in copy (story, headline,
    subline, kicker, cta, tagline, logo.direction), and the baked **logo + OG card** (which carry the old
    identity) are cleared (`logoUrl`/`ogImageUrl` = null) → re-surfaces the "Add your logo" bounty + the
    app tells the creator to remake them. `brand_profile.transcript` keeps the old name (it's a record).
  - Any identity change revalidates the storefront; story/tagline edits now cascade too (previously only
    a name change did, which left stale "Alpha Master" SEO descriptions — fixed).
  Open-ended redesigns go through **Eve — the forge** (EveDeveloping → preview → approve). If no
  site: `/api/creator/build-site` (Pro-gated; a `402` prompts the upgrade) provisions the website —
  but the **Build site button died with the Edit-site tab**, so the endpoint currently has no in-app
  door (bug — see `docs/ops/BUG_AUDIT_2026-08-20.md`). → `/api/creator/{site-config,enhance-copy,
  revise,revisions[/:id/approve|decline]}`.
- **Posts** — write/edit/publish/hide/delete journal posts with an optional cover image
  (`/api/creator/posts*`, `/api/creator/upload`). DB-backed, no redeploy.
- *(The Sell tab is gone — to be rebuilt later. **On-model shots** moved into the designer: the
  FinalizeSheet renders them at publish time (`POST /api/creator/model-shots`; the shots ride
  `/api/publish`), and the canvas offers ephemeral preview shots (`/api/creator/preview-shots`).
  Hide/show/delete products moved to **Market → My stores**. Scene shorts (`SceneShortComposer`)
  and the feed video ad (`/api/video`) are currently unreachable/parked — see
  `docs/ops/BUG_AUDIT_2026-08-20.md`.)*
- **Settings** — brand controls + performance. **Take your site live**: list the brand in the
  in-app Market + on nanocrew.app/<slug> with no website needed
  (`POST /api/creator/stores/:slug/publish`; `402` without an active plan, `409` with no published
  products). **Domain**: assign a custom domain / go live (`GoLiveComposer`). **Performance**:
  revenue, orders, 30-day views, avg margin, per-product margins, and recent orders with **refund**
  on refundable statuses. **Returns**: the return-claims inbox (`ReturnsInbox` →
  `/api/creator/returns`; approve → refund, or decline). **Danger zone**: **Delete this brand**
  (confirm dialog → `DELETE /api/creator/stores/:slug`, owner-only; cascades the store →
  catalogues/designs/products/variants/orders/posts/revisions; external resources cleaned out of
  band). On delete the console closes and the deck refetches.
- **Calls:** `/api/creator/{stats,orders,margins,posts,revisions[/:id/approve|decline],revise,
  site-config,enhance-copy,upload,credits,returns[/:id/approve|decline]}`, `/api/creator/stores/:slug`
  (PATCH/**DELETE**), `/api/creator/stores/:slug/publish`, `/api/creator/orders/:id/refund`.

### Earnings Cockpit (`src/components/earnings-cockpit.tsx`)
All-brands business overview (opened from Account → Earnings): revenue / orders / 30-day views /
to-fulfill, per-store breakdown, recent orders, product margins.

### Paywall (`src/components/paywall.tsx`)
Opens on a store-launch `402` (Studio) or from **Account → Subscription & billing**
(`reason="manage"`). Title/subtext adapt to the reason (`subscription_required`,
`brand_limit`, `manage`). Lists **subscription tiers** (credits/mo, brand cap, in-app store vs
website + custom domain, credit-rate discount) and **credit packs** (priced at your plan's rate).
On iOS, checkout runs through **Apple IAP** whenever it's ready (subscriptions + consumable credit
packs, verified by `/api/creator/billing/iap-verify`), falling back to **web Stripe Checkout**
(`/api/creator/billing/checkout`) otherwise; active subscribers get a
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

**Marks read as an inpaint mask, not a pen line (2026-08-19).** The region a stroke encloses is
tinted (`Polygon` fill under the `Polyline`), so the creator sees the patch of page they just handed
over — the same "mark the region, then describe it" language as the design editor's retouch, whose
strokes `src/lib/annotate.ts` bakes into the reference image.

**Subtitles live under the URL bar (2026-08-19).** They used to sit at the bottom of the Eve panel,
where the tab bar cut them in half. They are also trimmed to the LAST few words (`tailWords`,
`CAPTION_WORDS = 5`) so a long sentence rolls past like a caption instead of growing a paragraph,
and they are **speech-paced**: her transcript arrives from the model far ahead of her audio, so
words are revealed in proportion to the audio actually playing (`useSpokenText` + `SpeechWindow` in
`src/lib/caption.ts`, re-read every `TICK_MS` = 80ms off live-voice's `playStartedAt`/`playEndsAt`) —
at 40% through the sound, 40% of the words show — never running ahead of her voice and landing on
the last word as she stops. Rendering the stream directly raced her voice.

**Preview-ready push:** the forge **worker** (which marks revisions/provisions ready on the box)
push-notifies the creator on **ready** and on **failed** (Expo push to their `device_tokens`) — so
they're told when a preview lands or an edit didn't take, instead of watching "building…". (The
older `src/lib/notify.ts` path only covered the in-app synchronous revise.)

## 4. Design (`src/app/design.tsx`)

AI product designer — a zoomable canvas (the proven stephen-lawyer create→design→Printful loop). Auth
required; signed-out shows a graceful sign-in prompt rather than the canvas.

- **Setup popup (first thing on the tab):** pick the **brand** you're designing for, then **what
  for** — either **🌐 Site assets** (the brand's website: hero / logo / social — **no collection
  needed**) or a **collection** (products). Brand banner cards render at the OG card's own
  1200×630 ratio (uncropped) with a subtle border; the banner itself is **generated** —
  `/api/me` computes the OG card at read time for any logo'd brand missing one, so "Add a brand
  image" appears only for brands with no logo at all. The popup is a `<Modal>`, so it applies the
  screen's insets by hand (UI_RULES "Safe areas"). One brand → it's pre-selected and you land on the
  second step. The top-left chip (`Site assets ▾` or the collection name — no brand prefix) opens
  the full-screen product picker on tap (in Site-assets mode, this switcher instead); a long-press
  always reopens the brand/collection switcher.
  Catalogues are brand-scoped (`/api/catalogues?store=<slug>`, access-checked).
  - **Site assets mode** (`assetMode`): the dock opens on the **Site assets** segment and the session is
    backed by the brand's one persistent **"Web Assets"** collection (found or created on entry, the
    `WEB_ASSETS_COLLECTION` const) — so every graphic generated here is **stored** and reappears. That
    collection holds only design graphics (no published products), so it never shows as a shop
    collection (the public collections endpoint inner-joins published products). Site-asset slots write
    to the store (`/api/creator/site-assets` resolves the store from the catalogue); `cover` is hidden
    (it's a product-collection cover). Picking/creating a real collection exits the mode.
- **Top bar:** the collection chip (tap → full-screen product picker; long-press → switch
  brand/collection) + a strip of the products on the canvas (where the design-history strip used to
  be — tap a product to recenter on it; "＋" opens the picker).
- **Canvas:** node kinds — `design`, `template` (blank garment), `composition` (design-on-garment),
  `webslot` (a website-asset target), `group`. Pan/zoom, tap, box-select, blend. Auto-saves to
  `/api/canvas/:catalogueId`.
- **Generate (FAB):** a FULL-SCREEN panel (2026-08-18) — the top is a permanent PREVIEW window
  (dashed placeholder → progress → the staged image / reference, large), the form below: prompt,
  tool tiles, aspect ratio, **transparent/filled** (offered for BOTH Design and Graphics
  modalities — a transparent PNG logo vs a filled hero/banner; only `Aa Text` lettering is
  force-transparent), effort → `/api/generate` (Nano Banana; magenta chroma-key for transparency).
- **Compose:** drag a design onto a blank → `/api/compositions` → `/api/composite`; **PlacementEditor**
  (2026-08-17 redesign, v3 same day) is a FULL-SCREEN, NO-SCROLL editor: one direct-manipulation
  hero fills the measured stage at the garment photo's true aspect (Printful template image + real
  print-area geometry via `/api/blank/:id/template`, per-placement; multiply-blended so it reads as
  printed; dashed outline marks the print zone; drag/resize happens ON the garment and never yields
  to a scroll), and below it a FIXED TOOL TRAY — tab row **SIZE · COLOR · PLACE · ALIGN · EDGES ·
  PROOF** swapping ONE horizontal block rail at a time (Joe: no scrolling the page to reach
  options). EDGES = in-editor retouch: **✦ Remove background** (canned `/api/edit` custom instruction, 8 credits,
  mints a NEW design and swaps the placement to it — the autosave persists the swap) and feather
  (LIGHT/SOFT/HEAVY → `/api/creator/design-feather`, free, persists to the design). PROOF = generate + view the real Printful mockups. Picking a non-default
  colourway swaps the hero to that variant's catalog photo (real colour, approximate rect).
  Placements AUTOSAVE (debounced PATCH `/api/compositions/:id`) — no mockup render needed to
  persist. **FinalizeSheet** (also full-screen) sets — its pricing step shows colours as PHOTO CARDS: a grid of
  per-colourway Printful mockup shots (`/api/creator/color-mockups`, on-model style when the product
  offers one, flat otherwise; swatch placeholder until the ~15s generator task lands; tap toggles the
  colour for publish) — and sets
  name/collection/sizes/colors and publishes (`/api/publish`, with the cost+$5 price floor enforced).
- **Blend / Combine:** merge two designs (`/api/merge`) or pick placements for a design+product.
- **Catalogues/drops:** create with season presets, scoped to the chosen brand (`/api/catalogues`).
- **Dock (2 segments):** **Collection designs** (this collection's designs strip) · **Site assets**
  (the asset-tile strip below). Products are picked in a full-screen **ProductPicker**
  (`src/components/designer/ProductPicker.tsx` — the full Printful catalogue, `/api/blanks`,
  `/api/blank/:id/*`; large product cards — gender → type → product — with full, 2-line names so
  blanks read clearly), opened from the chip, "Add products", and right after setup.
- **Site assets — ASSET TILES (2026-08-18):** the text slot cards are GONE. One visual strip is
  both the live inventory and the entry points: Hero · Wordmark · App icon · Favicon · Social ·
  sections · **Images** (the free bucket — memes and anything else, no site slot). **Tap a tile**
  → the full-screen generator opens PRECONFIGURED for that asset (dimensions + background locked,
  per-asset best-practice guidelines appended to the prompt via `ASSET_TILE_DEFS`) with the CURRENT
  asset pre-staged — "change it" reprompts/imprints it (**○ Mark area**: draw red marker strokes
  on the image; they're baked into the reference server-side (`lib/annotate.ts`) and the model
  edits ONLY the marked region, erasing the marks — `/api/generate` `marks` param), Regenerate
  rerolls; the review toolbar is SQUARE icon tiles in a horizontal strip (pencil = Mark, wand =
  Apply, share = the NATIVE share sheet — download-to-cache + iOS Share → Save Image / Instagram /
  Files, no extra native deps); TAPPING a design/graphic thumb in the dock opens this edit flow
  pre-staged (canvas-add moved to long-press, which also gains "Share / save image"), and the
  approve CTA
  ("Set as hero" etc.) assigns straight to the slot. **Long-press a tile** drops its connect-target
  on the canvas (the drag-to-assign flow stays). Auto-generation (OG card, derived kit) is
  unchanged — these are creator overrides on top.
- **Site assets:** the LOGO surface is the **LogoKit** (`src/lib/logo-kit.ts`): two editable MASTERS —
  the wide **Wordmark** (slot `logo`) and the square **App icon** mark (slot `mark`) — with the mono
  variants, 1024² app tile, touch icon and favicon DERIVED on assignment (a new master re-derives the
  kit + `favicon_url`; pre-kit brands derive read-time from `logo_url`). Square tiles display the
  app tile; wordmarks render contain (cover-cropping mushed them). Canvas web-slot nodes PREVIEW the
  live site asset (icon placeholders are Ionicons — raw emoji drew missing-glyph "?" boxes, B17);
  the dock's Site-assets strip is the FULL editable inventory of what's LIVE on the site — Hero,
  Wordmark, App icon, Favicon (directly assignable), Social (override ?? the generated OG card),
  sections — each with a matching slot card / canvas target / Eve voice slot; the strip FIRST shows what's LIVE on the site (hero / logo /
  social / sections via GET `/api/creator/site-assets`), then this session's generated graphics;
  drag a graphic onto a web-slot target → it "clicks together," assigns to the brand
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
