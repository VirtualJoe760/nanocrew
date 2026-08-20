# Nano Crew — Remaining Features Audit

**The canonical roadmap.** Status of everything, grouped by what unblocks it. As of 2026-08-20.
Legend: 🟢 built · 🟡 partial · ⚪ not started · 🔒 blocked on an external/native dependency.

For the brand build→domain→live→Connect **lifecycle** specifically, see
[LIFECYCLE_ROADMAP.md](LIFECYCLE_ROADMAP.md) (Phases A–D code-complete; checkout hard-gates on
payout setup since 2026-08-16).
The original designer-parity plan lives in [FEATURE_ROADMAP.md](../archive/FEATURE_ROADMAP.md) (delivered;
historical).

## Scope — what we're focused on
The anti-creep guardrail (also in [../context/PROJECT_OVERVIEW.md](../context/PROJECT_OVERVIEW.md)).
"Out of scope" = **not the current focus**, not abandoned. Don't start deferred/parked work without
an explicit go.

| Bucket | Items |
|---|---|
| 🟢 **In flight** | App Store + Play launch & owner-config gates (Stripe live, Connect, domains, `PRINTFUL_CONFIRM_ORDERS`) · the **context system** · the **UI component system** (reuse refactor + build the missing primitives) · the **forge build-quality** epic (robot eyes + a real quality gate) |
| 🟡 **Deferred backlog** | **Affiliate / referral program** · **manufacturer-connect** (POD-provider onboarding) — will build, later |
| ⚪ **Parked / not now** | **Social feed v2** (built, hidden at `/feed`) · **native Metal-shader avatar port** · **new sales channels** (e.g. TikTok Shop) |

## 0. Shipped this session (2026-06-15/16)
- 🟢 **Mini-CMS (✦ Customize)** — Studio brand console → `SiteEditor` edits site copy/colors/fonts
  live with **no rebuild**: `stores.site_config` (migration 0018) via `POST /api/creator/site-config`;
  served by `GET /api/public/stores/:slug/site-config`; read by all 5 templates' `lib/site-config.ts`.
  Documented in STOREFRONT_DATA_CONTRACT, PAGES, DATABASE_PLAN. The **direct** (instant, deterministic)
  edit path — distinct from the forge (open-ended redesigns).
- 🟢 **✦ Enhance** — every mini-CMS text box has an AI rewrite-in-brand-voice button
  (`POST /api/creator/enhance-copy`, gemini-2.5-flash, free + rate-limited like `/api/enhance`).
- 🟢 **SEO layer (all 5 templates)** — `lib/seo.ts` (canonical siteUrl + Organization JSON-LD),
  layout metadata + OpenGraph/Twitter, product-page `generateMetadata` + Product JSON-LD (offers),
  blog-post `generateMetadata` + BlogPosting JSON-LD, `app/sitemap.ts`, `app/robots.ts`. See
  STOREFRONT_ENGINE "SEO".
- 🟢 **Cart icon** — templates' header shows a cart glyph + count badge (was a "Cart" text link).
- 🟢 **Account screen rebrand** — branded NC header + eyebrow; Sign out neutral, red reserved for
  Delete. (PAGES §5.)
- 🟢 **Design-tab brand→collection picker** — the tab opens with a setup popup (pick brand, then
  collection); finished web-slot groups (hero/cover/logo) auto-clear off the canvas. (PAGES §4.)
- 🟢 **Feed hidden for v1** — the social feed is removed from the tab bar (code preserved at `/feed`,
  returns in v2). The app now lands on **Eve** (the studio route became her page on 2026-07-05 —
  Studio's dashboard is the swipe-down brand deck); tabs are **Eve · Design · Market · Account**.
- 🟢 **Build-quality (partial)** — Eve authors the build brief (`authorBrandBrief`) + Master
  `CLAUDE.md` conditions the forge robot, both shipped. Remaining: sighted robot + real quality gate
  (see §7).

## 0b. Shipped since (Eve, 2026-06-18 → 2026-08-14)
- 🟢 **Typed chat mode** — the keyboard icon opens a full-screen chat window (`ChatInterview`,
  `src/components/chat-interview.tsx`) over the studio: message bubbles + a streaming assistant
  reply, her voice muted while typing, and Build appears once the interview has the essentials.
- 🟢 **Design popup** — Eve spawns designs in a translucent overlay over her own screen (`EveDesign`,
  `src/components/eve/eve-design.tsx`): generate from an idea, iterate by instruction
  (non-destructive `/api/edit`), keep it or open it in the Design tab. Renders over EveHome — not a
  screen swap — so her mic stays live throughout.
- 🟢 **Eve's digest — real numbers** — her guide view greets with a status report from
  `/api/creator/stats` (`src/lib/eve-digest.ts`); the live session is briefed with the real
  per-brand figures (`digestBriefing`) + explicit limits (all-time orders/revenue, 30-day views,
  nothing else), so she speaks from data and declines what she doesn't have. Still open:
  `GET /api/creator/sales-series` for real per-day/week trends.
- 🟢 **Eve sees what she makes** — `LiveVoiceSession.sendImage` + the one-way `eve-vision-bus`
  (`src/lib/eve-vision-bus.ts`): the design popup publishes each settled generation/edit and her
  live session receives a shrunk JPEG with a steering note, so she reacts to the actual image, not
  the prompt. Unqueued by design — sights are dropped when she isn't live.

## 0c. Shipped 2026-08-19 (the Eve field-test session)

- **Public beta signups now work end to end** — `POST /api/public/beta-signup` on platform-api +
  `beta_signups`: 50 slots per platform, iOS added to the TestFlight external group via the App
  Store Connect API, overflow waitlisted, ops notified per signup. The site form asks which phone
  and carries it through the OAuth round trip. (They previously reached nothing at all.)
- **Eve's site editor**: an EDIT sector on the wheel, answering "which brand?" routes, she finishes
  her line before the editor mounts, voice-paced subtitles, visible inpaint marks, panels clear the
  tab bar.
- **The forge fails loudly** instead of reporting a no-op revision as ready.
- **Outward brand surfaces** on the current identity: email shell, the social share card, the
  generated email mark + sender avatar, and `assets/brand/README.md` as real documentation.

Full record with evidence: [`../ops/SESSION_2026-08-19.json`](../ops/SESSION_2026-08-19.json).

### Found in that session, still open
- 🔴 **Designs bind to the creator's OLDEST brand** — `getCreatorStore()` (oldest by `createdAt`)
  via `/api/catalogues`; the design flow never asks which brand. A product made right after creating
  a brand lands in the wrong store.
- **A returning creator's brand interview runs on the `central` persona**, which has no brand job.
- **She suggests products outside the Printful catalogue** (`jobs/design.md` doesn't bound them).
- **The live socket gives up after one reconnect** — the counter is never reset (`live-voice.ts`).
- **"Put it on the All shirt"** — the CTA noun comes from the Printful category (`eve-design.tsx`).
- **Publish defaults** to the first colour alphabetically and to the minimum retail price (no margin).
- **No discard on the revision review** — only "Continue editing" / "Approve edits".
- **Sender avatar** — upload `nanocrew-avatar.png` to the sending domain's profile (BIMI/Gravatar);
  Resend's team avatar is dashboard-only.

## 1. Blocked on a native dev build (can't run in Expo Go)
These three all unlock with **one** EAS dev build. The server sides are already built.

- 🟢 **Apple IAP (in-app purchases) — shipped (StoreKit 2)** — `react-native-iap` (v15) is installed
  and in the binary; the server verifies via the **App Store Server API** (`src/lib/app-store.ts` +
  `iap-verify`, no legacy verifyReceipt), handling both plans and credit packs; the client
  (`src/lib/iap.ios.ts`) + paywall prefer IAP on iOS with web-Stripe fallback. Remaining is Joe's
  config: create the App Store Connect products (`com.nanocrew.credits.{500,1500,5000}` +
  `com.nanocrew.plan.{starter,pro,advanced}`) + an IAP API key, then set
  `APPLE_IAP_KEY_ID / ISSUER_ID / PRIVATE_KEY / APPLE_BUNDLE_ID` on Cloud Run. (Task #39)
- 🟢 **Push notifications — shipped** — `expo-notifications` is in the binary and `src/lib/push.ts`
  mints + registers the token (`PUSH_ENABLED = true`); `device_tokens`, `/api/creator/push-token`,
  and `notify.ts` delivery are live (revision "ready to review" fires once a token exists). Remote
  tokens mint only in a dev/production build (not Expo Go). (Task #35)
- 🟢 **Critique screenshots** — done, then upgraded (2026-06-20). The live-site editor is Eve-driven:
  talk via Gemini Live, tap the squiggle to mark a spot (circle/arrow/any shape; marks anchor to the
  page in document coords), type via the keyboard icon, then Submit. **The primary proof fed to Claude
  is now a REAL on-device annotated screenshot** (page + the mark), captured with `captureRef`
  (`react-native-view-shot` 4.0.3 — so it DOES need a dev build that bundles the native module), hosted
  by `/api/creator/revise`, downloaded by the droplet worker into `briefs/screenshots/`. If a build
  lacks the module, `captureRef` is guarded and the forge falls back to re-rendering the strokes via
  `~/critique-shot/render.mjs` (Playwright/Chromium; source `scripts/forge-critique-render.mjs`). The
  WebView DOM hit-test (`data-block`/heading/text/`data-nano-image`) rides along as a hint. See
  `docs/storefront/IMAGE_TARGETS.md` + `docs/studio/EDIT_PIPELINE.md`.

## 2. Blocked on your account / config (no code)
- ⚪ **Stripe go-live** — create 3 recurring Prices (`STRIPE_PRICE_{STARTER,PRO,ADVANCED}`); add the
  billing webhook → `nanocrew-api.vercel.app/api/public/billing-webhook` (`STRIPE_BILLING_WEBHOOK_SECRET`);
  swap test → live keys at launch — note [../ops/PAYOUTS_SETUP.md](../ops/PAYOUTS_SETUP.md) records
  `STRIPE_SECRET_KEY` as already live; confirm with Joe and strike the key-swap sub-item.
  (See PRODUCTION_CHECKLIST.)
- 🟡 **Auto first-drop** — `generateFirstDrop()` is wired into store creation but gated by
  `AUTO_FIRST_DROP=1` (real Gemini + Printful spend). Validate on one brand, then enable. (Task #26)
  **Resolved:** `first-drop.ts` now authenticates server-to-server via `INTERNAL_API_KEY` +
  `x-internal-creator` (acts as the store's creator), so set that env to enable it.
- ⚪ **Meta (Facebook) app** — required for the "Continue with Facebook" button: icon, privacy policy,
  data-deletion URL, category, review. (Task #18)

## 3. Web billing portal
- 🟢 **Billing management** — resolved: the Account "Subscription & billing" button now opens a
  Stripe **Customer Portal** session (`/api/creator/billing/portal`) to manage/cancel/update card +
  view invoices. The Paywall's in-app Checkout covers subscribe/top-up. (Task #14)

## 4. Unbuilt product features
- 🟢 **Product-page model gallery** — done (Task #31): `products.model_shots` + `/api/creator/model-shots`
  (Nano Banana, credit-gated) + Sell-tab trigger; surfaced on the storefront product page (all 5 templates)
  via the public catalog. Generating spends real AI credits — validate on one product.
- 🟢 **Veo on-model videos on websites** — done (Task #33): `products.model_videos` +
  `/api/creator/model-videos` (Veo, ownership + rate-limited + 400-credit-gated, appends up to 3
  angles) + Studio Sell-tab "film" trigger. Surfaced on the storefront product page (on-model film
  gallery) and the homepage **featured video wall** (new `VideoGallery` block, 4 of the 5 templates
  — street lacks it, see the parity item below) via the public `/videos` endpoint. Generating
  spends real Veo credits — validate on one product.
- 🟢 **Template polish** — done (Task #32): dependency-free premium-motion layer (smooth scroll,
  transitions, image hover-zoom, page-entrance fade) in 4 of the 5 templates' `globals.css`
  (street lacks it, see the parity item below).
- 🟢 **In-app platform admin** — done: Account → "Platform admin" (admin emails only) opens a
  metrics + all-stores overview. (Task #25)
- 🟢 **Creator /admin on the brand websites** — done (Task #24): the brand-site `/admin` now has the
  full surface — Nano Crew sign-in (magic-link/password), revenue/orders/views, recent orders +
  tracking, the **Journal** composer, and a new **Edit your site** panel (`components/blocks/site-editor.tsx`,
  synced to 4 of the 5 templates — street lacks it, see the parity item below) that requests
  changes → reviews the preview → publishes, using new
  CORS'd platform-api routes `POST /api/creator/revise`, `GET /api/creator/revisions`,
  `POST /api/creator/revisions/:id/approve`. Approve merges the branch via **GitHub's merge API**
  (serverless — no SSH), so platform-api needs `GITHUB_OWNER` + `GITHUB_TOKEN` set on its Vercel project.
- 🟡 **Studio media uploads** — Cloudinary image upload from the composer (post cover images, etc.)
  is partial. (Task #23)
- ⚪ **street template parity** — the 5th template (`street`, a live provisioning target via
  `designStyle: 'street'`) has the SEO layer, site-config, and model shots, but lacks the `/admin`
  **Edit your site** panel, the video-gallery/hero-video blocks, and the premium-motion layer the
  other four ship — bring it to parity or record the exception. (See
  [../ops/BUG_AUDIT_2026-08-20.md](../ops/BUG_AUDIT_2026-08-20.md).)

## 5. Brand / polish cleanup (small)
- 🟢 **Brand typeface** — Jost, self-hosted (`assets/fonts/`) in both the app and the site. The
  earlier General Sans plan is superseded.
- 🟢 **Brand-store accent fallback** — superseded by the cool-monochrome rebrand: app chrome uses
  the platinum accent (`src/constants/theme.ts`); brand storefronts keep their own colours.
- ⚪ **Custom tab-bar glyphs** — tabs use Ionicons + the platinum tint on a custom JS bar
  (`src/components/app-tabs.tsx`); true NC-monogram glyphs would still need custom artwork.
- 🟢 **Designer endpoints auth** — resolved (verified 2026-06-13): `/api/generate`, `/api/designs`,
  `/api/compositions`, `/api/publish` (+ their `[id]` routes) all call `getUserFromRequest` (401 on no
  user) and enforce per-creator ownership via `assertCatalogueOwner` / `assertCompositionOwner` /
  `assertDesignOwner` (`src/lib/tenant.ts`). No default-store fallback remains.

## 6. Verification still owed (not code)
- ⚪ **On-device test pass** of the recent designer + selection features. (Task #1)
- ⚪ **End-to-end live tests:** a real subscribe → store-launch → first-drop → purchase → fulfilment
  run with live keys; a real critique → revision → approve → merge run from a device.

## 7. Build quality — remaining (the sighted forge)
The first two of three fixes shipped (Eve authors the brief; Master `CLAUDE.md` conditions the
robot — see [../studio/FORGE_AI.md](../studio/FORGE_AI.md) and
[../storefront/BUILD_QUALITY.md](../storefront/BUILD_QUALITY.md)). Status:
- ⚪ **Give the forge robot eyes + a self-critique loop on the provision path** — screenshot the
  built site, judge it against the brief + quality checklist, iterate before finishing. (The
  annotated-screenshot rig already used for revisions is the foundation.)
- 🟢 **Fail loudly on the robot's exit code** — shipped 2026-08-19: the `|| true` swallow is gone on
  both provision and revise (`CLAUDE_OK`/`CLAUDE_FAILED` branches in `forge-worker/worker.mjs`); a
  robot or build failure reverts the store to `draft`, fails the revision row, and notifies the
  creator — never a false `ready`.
- ⚪ **A real quality gate** — judge the built site against the brief + quality checklist, not just
  "does it compile," so a weak (but compiling) build doesn't silently ship.


## Web account surface (2026-08-16)
`nanocrew.app/account` now mirrors the app's Account page for: profile details (name/phone —
editable on the web, which the app still doesn't allow), **your brands**, **collaborators**
(invite/remove/revoke, owner-only) and **Stripe payout setup** (reuses the app's existing
`/api/creator/connect`).

Still app-only, by scope: earnings, orders/purchases, subscription & paywall, platform admin,
Eve Lab, and account deletion.
