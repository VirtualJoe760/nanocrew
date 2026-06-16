# Nano Crew — Remaining Features Audit

**The canonical roadmap.** Status of everything, grouped by what unblocks it. As of 2026-06-16.
Legend: 🟢 built · 🟡 partial · ⚪ not started · 🔒 blocked on an external/native dependency.

For the brand build→domain→live→Connect **lifecycle** specifically, see
[LIFECYCLE_ROADMAP.md](LIFECYCLE_ROADMAP.md) (Phases A–D code-complete, inert until Joe's config).
The original designer-parity plan lives in [FEATURE_ROADMAP.md](FEATURE_ROADMAP.md) (delivered;
historical).

## 0. Shipped this session (2026-06-15/16)
- 🟢 **Mini-CMS (✦ Customize)** — Studio brand console → `SiteEditor` edits site copy/colors/fonts
  live with **no rebuild**: `stores.site_config` (migration 0018) via `POST /api/creator/site-config`;
  served by `GET /api/public/stores/:slug/site-config`; read by all 4 templates' `lib/site-config.ts`.
  Documented in STOREFRONT_DATA_CONTRACT, PAGES, DATABASE_PLAN. The **direct** (instant, deterministic)
  edit path — distinct from the forge (open-ended redesigns).
- 🟢 **✦ Enhance** — every mini-CMS text box has an AI rewrite-in-brand-voice button
  (`POST /api/creator/enhance-copy`, gemini-2.5-flash, free + rate-limited like `/api/enhance`).
- 🟢 **SEO layer (all 4 templates)** — `lib/seo.ts` (canonical siteUrl + Organization JSON-LD),
  layout metadata + OpenGraph/Twitter, product-page `generateMetadata` + Product JSON-LD (offers),
  blog-post `generateMetadata` + BlogPosting JSON-LD, `app/sitemap.ts`, `app/robots.ts`. See
  STOREFRONT_ENGINE "SEO".
- 🟢 **Cart icon** — templates' header shows a cart glyph + count badge (was a "Cart" text link).
- 🟢 **Account screen rebrand** — branded NC header + eyebrow; Sign out neutral, red reserved for
  Delete. (PAGES §5.)
- 🟢 **Design-tab brand→collection picker** — the tab opens with a setup popup (pick brand, then
  collection); finished web-slot groups (hero/cover/logo) auto-clear off the canvas. (PAGES §4.)
- 🟢 **Feed hidden for v1** — the social feed is removed from the tab bar (code preserved at `/feed`,
  returns in v2). The app now lands on **Studio**; tabs are **Studio · Design · Market · Account**.
- 🟢 **Build-quality (partial)** — Venus authors the build brief (`authorBrandBrief`) + Master
  `CLAUDE.md` conditions the forge robot, both shipped. Remaining: sighted robot + real quality gate
  (see §7).

## 1. Blocked on a native dev build (can't run in Expo Go)
These three all unlock with **one** EAS dev build. The server sides are already built.

- 🔒 **Apple IAP (in-app purchases)** — server verify (`/api/creator/billing/iap-verify`) + product
  catalogue + client seam exist. Needs: `npx expo install react-native-iap`, a dev build, App Store
  Connect consumable products, `APPLE_IAP_SHARED_SECRET`, then flip `IAP_ENABLED` in `src/lib/iap.ts`
  and fill the StoreKit calls. (Task #39)
- 🔒 **Push notifications** — `device_tokens` table, registration endpoint, and `notify.ts` delivery
  are live (revision "ready to review" fires once a token exists). Needs: `expo-notifications` + dev
  build + mint the token (`src/lib/push.ts`, `PUSH_ENABLED`). (Task #35)
- 🟢 **Critique screenshots** — done (Task #34). The site editor is a turn-based, Venus-driven flow:
  tap the orb to talk (she speaks back via TTS, the orb rides the live audio), tap the pen to circle
  (one circle per tap; marks anchor to the page in document coords and scroll with their section),
  type instead via the keyboard icon, then Submit a reviewable, itemised batch. Each circle is
  resolved via a WebView DOM hit-test (`data-block` / heading / text) **and** re-rendered into a real
  **annotated screenshot on the forge**: Playwright/Chromium (`~/critique-shot/render.mjs` on the
  droplet, source: `scripts/forge-critique-render.mjs`) reloads the live page, overlays the gold
  circles at their document coords, crops to the region → `briefs/screenshots/` for Claude, then
  deletes them before commit so they never land in the brand repo. No dev build / `react-native-view-shot`
  needed. (Branch-for-review + "ready" push notification were already in `revise.ts`.)

## 2. Blocked on your account / config (no code)
- ⚪ **Stripe go-live** — create 3 recurring Prices (`STRIPE_PRICE_{STARTER,PRO,ADVANCED}`); add the
  billing webhook → `nanocrew-api.vercel.app/api/public/billing-webhook` (`STRIPE_BILLING_WEBHOOK_SECRET`);
  swap test → live keys at launch. (See PRODUCTION_CHECKLIST.)
- 🟡 **Auto first-drop** — `generateFirstDrop()` is wired into store creation but gated by
  `AUTO_FIRST_DROP=1` (real Gemini + Printful spend). Validate on one brand, then enable. (Task #26)
  **Resolved:** `first-drop.ts` now authenticates server-to-server via `INTERNAL_API_KEY` +
  `x-internal-creator` (acts as the store's creator), so set that env to enable it. (The CLI
  `scripts/first-drop.mjs` would need the same headers if used directly.)
- ⚪ **Meta (Facebook) app** — required for the "Continue with Facebook" button: icon, privacy policy,
  data-deletion URL, category, review. (Task #18)

## 3. Web billing portal
- 🟢 **Billing management** — resolved: the Account "Subscription & billing" button now opens a
  Stripe **Customer Portal** session (`/api/creator/billing/portal`) to manage/cancel/update card +
  view invoices. The Paywall's in-app Checkout covers subscribe/top-up. (Task #14)

## 4. Unbuilt product features
- 🟢 **Product-page model gallery** — done (Task #31): `products.model_shots` + `/api/creator/model-shots`
  (Nano Banana, credit-gated) + Sell-tab trigger; surfaced on the storefront product page (all 4 templates)
  via the public catalog. Generating spends real AI credits — validate on one product.
- 🟢 **Veo on-model videos on websites** — done (Task #33): `products.model_videos` +
  `/api/creator/model-videos` (Veo, ownership + rate-limited + 400-credit-gated, appends up to 3
  angles) + Studio Sell-tab "film" trigger. Surfaced on the storefront product page (on-model film
  gallery) and the homepage **featured video wall** (new `VideoGallery` block, all 4 templates) via
  the public `/videos` endpoint. Generating spends real Veo credits — validate on one product.
- 🟢 **Template polish** — done (Task #32): dependency-free premium-motion layer (smooth scroll,
  transitions, image hover-zoom, page-entrance fade) in all 4 templates' `globals.css`.
- 🟢 **In-app platform admin** — done: Account → "Platform admin" (admin emails only) opens a
  metrics + all-stores overview. (Task #25)
- 🟢 **Creator /admin on the brand websites** — done (Task #24): the brand-site `/admin` now has the
  full surface — Nano Crew sign-in (magic-link/password), revenue/orders/views, recent orders +
  tracking, the **Journal** composer, and a new **Edit your site** panel (`components/blocks/site-editor.tsx`,
  synced to all 4 templates) that requests changes → reviews the preview → publishes, using new
  CORS'd platform-api routes `POST /api/creator/revise`, `GET /api/creator/revisions`,
  `POST /api/creator/revisions/:id/approve`. Approve merges the branch via **GitHub's merge API**
  (serverless — no SSH), so platform-api needs `GITHUB_OWNER` + `GITHUB_TOKEN` set on its Vercel project.
- 🟡 **Studio media uploads** — Cloudinary image upload from the composer (post cover images, etc.)
  is partial. (Task #23)

## 5. Brand / polish cleanup (small)
- ⚪ **General Sans font** — the brand typeface isn't bundled (system sans stand-in). Needs the font
  files + `expo-font`.
- 🟢 **Brand-store accent fallback** — fixed: falls back to gold `#c9a86a` (was cyan).
- ⚪ **Custom tab-bar glyphs** — tabs use SF Symbols + gold tint; true NC-monogram glyphs would need a
  custom JS tab bar.
- 🟢 **Designer endpoints auth** — resolved (verified 2026-06-13): `/api/generate`, `/api/designs`,
  `/api/compositions`, `/api/publish` (+ their `[id]` routes) all call `getUserFromRequest` (401 on no
  user) and enforce per-creator ownership via `assertCatalogueOwner` / `assertCompositionOwner` /
  `assertDesignOwner` (`src/lib/tenant.ts`). No default-store fallback remains.

## 6. Verification still owed (not code)
- ⚪ **On-device test pass** of the recent designer + selection features. (Task #1)
- ⚪ **End-to-end live tests:** a real subscribe → store-launch → first-drop → purchase → fulfilment
  run with live keys; a real critique → revision → approve → merge run from a device.

## 7. Build quality — remaining (the sighted forge)
The first two of three fixes shipped (Venus authors the brief; Master `CLAUDE.md` conditions the
robot — see [../studio/FORGE_AI.md](../studio/FORGE_AI.md) and
[../storefront/BUILD_QUALITY.md](../storefront/BUILD_QUALITY.md)). Still open:
- ⚪ **Give the forge robot eyes + a self-critique loop on the provision path** — screenshot the
  built site, judge it against the brief + quality checklist, iterate before finishing. (The
  annotated-screenshot rig already used for revisions is the foundation.)
- ⚪ **A real quality gate** — stop swallowing the robot's exit code (`|| true`) and gate the
  `ready`-flip on more than "does it compile," so a weak build doesn't silently ship.
