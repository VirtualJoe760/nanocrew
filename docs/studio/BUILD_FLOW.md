# Build Flow — talk to Venus, get a brand, refine it, publish

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
1. INTERVIEW   creator talks to Venus (Studio tab)        → BrandResult + transcript
2. BUILD       brief authored → forge robot builds a       → presentable site w/ TEMPORARY imagery
               presentable site (templates + tokens)         (store + fulfilment already wired)
3. REFINE      creator makes real products / model shots   → real assets PROGRESSIVELY REPLACE
               / scene video in the Design generator          the temporary placeholders
4. PUBLISH     link a domain, go live                      → zero placeholders, store + fulfilment
                                                              active, mirrored in the Nano Crew app
```

## 1 · Interview — the creator talks to Venus

Entry point is the **Studio tab** (`src/app/studio.tsx`). It's gated, not auto-launched: a new
creator picks a voice and taps *Get started*, which runs the interview in `mode: 'interview'`;
returning creators with a store land on the dashboard.

**Venus** is the brand consultant (`src/lib/interview.ts`, `interviewSystem()`). She runs voice-first
(`/api/voice` — Gemini hears the audio, ElevenLabs voices the reply) with a typed fallback
(`/api/interview`). She's a warm, ≤18-word-per-turn cheerleader who also collects data: name + core
idea, logo direction, palette, design temperament, **how the site should feel/manifest**, and the
products they're excited to sell. A **hard rule** binds her — *never override an explicit choice*
(if they say "black and white", the palette is exactly that; she fills only the gaps they leave).

She ends by emitting a `BrandResult` (and a spoken closing). The shape that everything downstream
consumes (`src/lib/interview.ts`):

- identity: `name`, `tagline`, `mission`, `audience`, `voice`, `story`, `vibeKeywords`
- `designStyle`: `minimalist | bold | elegant | extravagant` → **picks the template**
- `designSystem`: `palette` (exactly 5 roled hexes), `typography`, `texture`, `motion`
- `products` and `logo.direction`
- **`siteNotes`** — the creator's site wishes kept **verbatim** ("a slideshow up top", "a video
  behind the logo"). These are the only freeform layout intent that survives into the build. **Venus
  translates them to concrete blocks** via the template's `VOCABULARY.md` when she authors the build
  brief (`authorBrandBrief`) — the forge receives named blocks, not the creator's loose words.

The store row is created and `provisionStorefront()` is fired. (A brand that launched shop-only on
Starter can add a website later via `POST /api/creator/build-site` — a Pro+ feature — which rebuilds
the `BrandResult` from the stored profile and fires the same pipeline.)

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

Site **look** edits (not catalogue) ride a different rail: the creator tells Venus "make the hero
bigger", which enqueues a branch-based **revision** (Vercel preview → approve → merge). That's the
storefront engine's revision path, not the design generator.

## 4 · Publish — go live

The final step turns a refined site into a launched brand:

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
| Interview | ✅ works (voice + text) | ✅ good — Venus captures intent incl. verbatim `siteNotes` | richer capture feeds a masterful build prompt |
| Build | ✅ works (templates + forge) | ⚠️ weak — mail-merge brief, unconditioned robot, no self-check | Venus-authored prompt + conditioned robot + eyes ([FORGE_AI.md](FORGE_AI.md)) |
| Refine | ✅ works | ✅ assets are strong; placeholder→real swap works | same, just less to fix because build starts stronger |
| Publish | ✅ works | ✅ store/fulfilment/mirror solid | domain + go-live with a build that was great from step 2 |
