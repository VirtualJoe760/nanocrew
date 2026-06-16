# Build Quality — why one generated site looks like a brand and the other doesn't

**The standard:** every site the forge ships should look like a real brand on first build —
presentable immediately, then refined to perfect with real assets, then published. Today it
doesn't. This doc is the evidence + root-cause, captured 2026-06-15 by comparing our one strong
site against a fresh forge-generated one.

## A/B — same engine, opposite results

| | **stephenlawyer.clothing** (strong) | **store-alpha-master.vercel.app** (weak) |
|---|---|---|
| Hero | Full-bleed action photo + massive wordmark + news ticker + bold CTA | **Blank white** with floating text; CTA looks **greyed-out/broken** |
| Products | **Real mockups** w/ prices + colour swatches (Coast Sunset Crew $78 …) | **Template stock placeholders** — coffee beans, high-heels, a foggy mountain, a derelict building — labelled "Essential Tee $28" etc. |
| On-brand? | Cohesive skate/editorial world | Off-brand junk for a *patriotic apparel* brand |
| Feel | A brand | A barely-configured template |

> Stephen Lawyer looks good because a **human designed it** (it's the imported bespoke site).
> Alpha Master is what **our pipeline actually produces today**. The gap is the work.

## Root causes (each maps to a fix in our flow)

1. **No hero/section imagery direction** → blank white hero. The brief never tells the robot to
   establish presentable, brand-appropriate **temporary imagery** on first build.
2. **Template placeholders never replaced** → coffee beans as "patriotic apparel." When a store has
   **no real products**, the template's built-in mock products show through unchanged, and nothing
   swaps the stock images for anything on-brand.
3. **CTA looks broken** → no standing rule that primary CTAs must be styled, high-contrast, working.
4. **Brief is a mail-merge, not a prompt** → no art direction, no taste, flattened intent
   (see [STOREFRONT_ENGINE.md](STOREFRONT_ENGINE.md) `buildBrandBrief`). Task: make Venus *author* it.
5. **Robot is unconditioned** → no Master `CLAUDE.md` on the forge; no quality bar, no anti-kitsch
   rule, no "make it presentable" mandate. Task: write the Master `CLAUDE.md`.
6. **No eyes, no self-check, silent failure** → the forge runs the robot one-shot, ends the command
   in `|| true`, and only checks "does it compile" — never "does it look good." A bad build ships and
   the store flips to `ready` anyway.

## The target — a build→refine→publish arc

1. **Build (instant + presentable):** Venus authors a masterful prompt → the conditioned forge robot
   adapts the template, writes real CTAs/copy, and drops in **intentional, on-brand temporary
   imagery** so the site looks finished on day one — already wired to DB + store + fulfilment.
2. **Refine (creator's editorial control):** in the **design generator** the creator makes the real
   products, featured images, and video; these **progressively replace** the temporary imagery.
3. **Publish (go live):** link a domain, push live with **zero placeholders**, a faithful brand,
   and the **store + fulfilment active and mirrored in the Nanocrew app**.

## What "good" requires (the checklist the robot should pass)

- A hero with real atmosphere (image/video), not text on white.
- A styled, working primary CTA.
- Featured section shows the brand's **own** products — or branded temporary tiles, **never** generic
  template stock.
- Copy in the brand's voice, grounded in the creator's actual words (not invented marketing filler).
- Palette/typography faithful to the creator's stated nuance.
- The robot **looked at its own output** (screenshot) and judged it against the brief before finishing.

See the build-quality task epic in the project task list, and
[STOREFRONT_ENGINE.md](STOREFRONT_ENGINE.md) for the pipeline this plugs into.
