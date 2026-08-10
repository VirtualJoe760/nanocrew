# Build Flow — talk to Eve, get a brand, refine it, publish

The creator's end-to-end arc. This doc is the **narrative spine**: what the creator experiences and
which system handles each step. It deliberately does **not** re-explain the pipeline mechanics —
those live in [`docs/storefront/STOREFRONT_ENGINE.md`](../storefront/STOREFRONT_ENGINE.md) (build +
revise) and [`docs/storefront/STOREFRONT_DATA_CONTRACT.md`](../storefront/STOREFRONT_DATA_CONTRACT.md)
(how a live site reads data). Read those for the "how"; read this for the "what + when".

> **⚠️ CURRENT vs TARGET runs through this whole doc.** The *shape* of the arc (build → refine →
> publish) is real and shipping. The *quality* of the first build is not there yet: today the brief
> the forge robot receives is a code mail-merge and the robot is unconditioned, so a first build
> looks like a barely-configured template, not a brand. The root-cause + target are in
> [`docs/storefront/BUILD_QUALITY.md`](../storefront/BUILD_QUALITY.md); the AI-to-robot seam this
> all hinges on is [FORGE_AI.md](FORGE_AI.md).

## The arc at a glance

```
1. INTERVIEW   creator talks to Eve (Studio tab)        → BrandResult + transcript
2. BUILD       brief authored → forge robot builds a       → presentable site w/ TEMPORARY imagery
               presentable site (templates + tokens)         (store + fulfilment already wired)
3. REFINE      creator makes real products / model shots   → real assets PROGRESSIVELY REPLACE
               / scene video in the Design generator          the temporary placeholders
4. PUBLISH     link a domain, go live                      → zero placeholders, store + fulfilment
                                                              active, mirrored in the Nano Crew app
```

## 1 · Interview — the creator talks to Eve

Entry point is the **Studio tab** (`src/app/studio.tsx`). It's gated, not auto-launched, and never
starts Eve talking before the creator is ready. Flow: pick a voice (`mode: 'cta'`) → a **primer**
(`mode: 'primer'`) that previews what Eve will ask and offers two ways in — **"Talk with Eve"**
(recommended; requests the mic *here*, the only place we prompt) or **"I'd rather type"** (starts in
keyboard mode, no mic) — → the interview (`mode: 'interview'`), where Eve greets. Returning creators
with a store land on the dashboard.

**Voice is push-to-talk (hold-to-talk):** the creator **holds the orb to record and releases to
send** (`beginHold`/`endHold`); holding while Eve is speaking interrupts her and starts recording.
This is deliberate — the old auto-listen/silence-detection turn-taking raced the audio session (she'd
return text but not speak, or not respond at all), so it was removed for deterministic turns. After she
finishes a reply the orb just goes **idle** and waits for the next hold. The conversation also
**auto-pauses when the Studio tab loses focus** (a `playSpeech` focus/pause guard), and there's a
prominent **Pause/Resume pill** beneath the orb (plus the header control); holding the orb resumes.

**Eve** is the brand consultant. She runs as a realtime **Gemini Live** speech-to-speech session
(`src/lib/live-voice.ts` + `hooks/use-live-voice.ts`; persona prompt in `live-voice.ts`), open-mic with
a typed fallback into the same session. When she's gathered enough she calls/extracts the brand via
`/api/extract-brand` (which reuses `interview.ts` `interviewSystem`/`parseTurn`). She's a warm,
≤18-word-per-turn cheerleader who also collects data: name + core
idea, logo direction, palette, design temperament, **how the site should feel/manifest**, and the
products they're excited to sell. A **hard rule** binds her — *never override an explicit choice*
(if they say "black and white", the palette is exactly that; she fills only the gaps they leave).

She ends by emitting a `BrandResult` (and a spoken closing). The shape that everything downstream
consumes (`src/lib/interview.ts`):

- identity: `name`, `tagline`, `mission`, `audience`, `voice`, `story`, `vibeKeywords`
- `designStyle`: `minimalist | bold | elegant | extravagant | street` → **picks the template**
- `designSystem`: `palette` (exactly 5 roled hexes), `typography`, `texture`, `motion`
- `products` and `logo.direction`
- **`siteNotes`** — the creator's site wishes kept **verbatim** ("a slideshow up top", "a video
  behind the logo"). These are the only freeform layout intent that survives into the build. **Eve
  translates them to concrete blocks** via the template's `VOCABULARY.md` when she authors the build
  brief (`authorBrandBrief`) — the forge receives named blocks, not the creator's loose words.

**The creator reviews before committing.** The `BrandResult` lands on the editable **BRAND COMPILED**
screen (`src/components/brand-review.tsx`), where they can tweak the **name, tagline, story, and full
palette** (tap a swatch → the shared gradient hex picker) and **switch website templates** from a
horizontal picker that renders all 5 templates as live mini-mockups painted in the brand's own colors.
Edits mutate the `BrandResult` in place, so whatever they approve is exactly what `createStore` sends.
Only on **Create my store** is the row created.

The store row is created and `provisionStorefront()` is fired. (A brand that launched shop-only on
Starter can add a website later via `POST /api/creator/build-site` — a Pro+ feature — which rebuilds
the `BrandResult` from the stored profile and fires the same pipeline. `build-site` now **refuses a
brand with no `designSystem`** — `422 no_design_system` — instead of firing a doomed provision.)

**The "building…" state is durable.** The Studio console's Edit-site tab
(`src/components/studio-composer.tsx`) derives "building" from **durable signals** — the store's
`status` plus the provision job row in `store_revisions` — not a local flag, so it survives the
creator reopening the console and self-heals on a ~6s poll. It shows an animated progress bar,
elapsed timer, and phase label, plus a **"build didn't finish"** failure state.
`provisionStorefront()` records a **failed `store_revisions` row** on error, so failures surface
instead of vanishing.

## 2 · Build — the forge robot builds a presentable site

This is the storefront engine's job; the creator just sees "building…". The mechanics (per-brand
GitHub repo, `brand.json` + briefs written deterministically, enqueue → forge worker drains the
queue → clone template → headless `claude` brands it → `pnpm build` gate → push → Vercel deploy →
store flips to `ready`) are documented in
[`STOREFRONT_ENGINE.md`](../storefront/STOREFRONT_ENGINE.md). Don't duplicate it here.

What matters at *this* altitude is the **intent** of the build step and how far reality is from it:

- **Intent:** the site should look like a real brand on day one — a hero with atmosphere, a styled
  working CTA, copy in the brand's voice, and **intentional on-brand temporary imagery** standing in
  until real products exist — already wired to the DB + store + fulfilment.
- **CURRENT reality:** the build ships a barely-configured template. Blank-white hero, the template's
  stock placeholder products showing through (coffee beans labelled "Essential Tee"), a CTA that
  looks broken. The A/B evidence is in
  [`docs/storefront/BUILD_QUALITY.md`](../storefront/BUILD_QUALITY.md).
- **Why:** the brief is a mail-merge, not a prompt; the robot is unconditioned; it never looks at its
  own output. The full diagnosis + plan is [FORGE_AI.md](FORGE_AI.md) — the seam where our AI talks
  to the forge robot is where this gets fixed.

The key promise the build step *does* keep today, even when it looks weak: the storefront is already
a **headless client of the platform API** — store, catalogue, checkout, and Printful fulfilment are
wired from the first deploy (see [STOREFRONT_DATA_CONTRACT.md](../storefront/STOREFRONT_DATA_CONTRACT.md)).
So the moment real products exist, they flow in.

## 3 · Refine — the creator makes the real assets

The first build is meant to be **presentable, not finished**. The creator now opens the **Design
tab** and makes the brand's actual product world — AI-generated artwork dropped onto real Printful
apparel, on-model photo galleries, and "cool short" scene videos. These are the assets that
**progressively replace** the temporary placeholders the forge shipped.

How each asset is made, and exactly how it reaches the live site, is its own doc:

> **➜ [DESIGN_GENERATOR.md](DESIGN_GENERATOR.md)** — the design canvas, Printful publish, model
> shots, and scene video; the asset pipeline that swaps placeholders for the brand's real product
> imagery.

The connecting rule (from the data contract): publishing or deleting a product writes to the app's
Postgres — the single source of truth — and fire-and-forgets a `revalidateStorefront(slug)` rebuild,
so the live site self-heals to show the real catalogue. The creator never edits the brand repo to do
this; the catalogue flows through the platform API.

Site **look** edits (not catalogue) ride a different rail: the creator tells Eve "make the hero
bigger", which enqueues a branch-based **revision** (Vercel preview → approve → merge). That's the
storefront engine's revision path, not the design generator.

## 4 · Publish — go live

**Selling is now decoupled from websites.** The cheapest path to live is **app-only Publish**:
`POST /api/creator/stores/:slug/publish { listed }` (`src/app/api/creator/stores/[slug]/publish+api.ts`)
sets `isPublic + status='live'` with **only an active plan + ≥1 published product — NO website, NO
custom domain**. That lists the brand in the in-app **Market** (`/api/market` lists
`isPublic && status='live'`) and on `nanocrew.app/b/<slug>` (see
[STOREFRONT_DATA_CONTRACT.md](../storefront/STOREFRONT_DATA_CONTRACT.md)). Studio → Settings →
**"Marketplace → Open shop"** drives it; `listed: false` closes the shop. A **custom domain /
dedicated website** (the go-live flow below) is now a **separate Pro upgrade layered on top — not a
prerequisite to sell**.

The fuller step turns a refined site into a launched brand with its own domain:

- **Link a domain** (custom domain on Vercel; a Pro+/lifecycle feature — see the `lifecycle-phases`
  notes and `docs/storefront/STOREFRONT_ENGINE.md`).
- **Go live with zero placeholders** — every temporary tile replaced by the brand's own products,
  copy in the brand's voice, palette/typography faithful to what the creator chose.
- **Store + fulfilment active** — checkout runs through the central POS (`/api/public/checkout` →
  Stripe → Printful); no secret ever lives in the brand repo.
- **Mirrored in the Nano Crew app** — the same products feed the Market tab (and the feed when it
  returns in v2 — the social feed is hidden for v1), because
  publish writes to the shared catalogue (`/api/publish` mirrors into `products`/`variants`).

## The honest summary

| Step | Shape today | Quality today | Target |
|---|---|---|---|
| Interview | ✅ works (voice + text) | ✅ good — Eve captures intent incl. verbatim `siteNotes` | richer capture feeds a masterful build prompt |
| Build | ✅ works (templates + forge) | ⚠️ weak — mail-merge brief, unconditioned robot, no self-check | Eve-authored prompt + conditioned robot + eyes ([FORGE_AI.md](FORGE_AI.md)) |
| Refine | ✅ works | ✅ assets are strong; placeholder→real swap works | same, just less to fix because build starts stronger |
| Publish | ✅ works | ✅ store/fulfilment/mirror solid | domain + go-live with a build that was great from step 2 |
