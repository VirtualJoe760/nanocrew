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
4. ~~**Brief is a mail-merge, not a prompt**~~ → **✅ FIXED.** `authorBrandBrief()` in
   `src/lib/provision.ts` now has `gemini-2.5-pro` *author* an art-directed `01-BRAND.md` from the
   `BrandResult` + transcript + `siteNotes` (mail-merge kept only as never-break fallback). See
   [../studio/FORGE_AI.md](../studio/FORGE_AI.md).
5. ~~**Robot is unconditioned**~~ → **✅ FIXED.** A Master `CLAUDE.md` (`forge-worker/forge-CLAUDE.md`
   → `/home/forge/.claude/CLAUDE.md`) now conditions every build + revision with the quality bar,
   anti-kitsch rule, "make it presentable" mandate, data-is-law, the off-limits rails, and
   always-build + self-check. See [../studio/FORGE_AI.md](../studio/FORGE_AI.md).
6. **No eyes, no self-check, silent failure** → the forge runs the robot one-shot, ends the command
   in `|| true`, and only checks "does it compile" — never "does it look good." A bad build ships and
   the store flips to `ready` anyway.
7. ~~**Edit-fidelity gap — a correct copy edit silently doesn't render**~~ → **✅ FIXED**
   (2026-06-17). Eve edited `content/copy.json` `hero.cta` → "Shop the drop", the build was green,
   the branch + preview deployed — but the hero kept showing "Discover". Root cause: at provision the
   robot composes the richer `<HeroVideo />` **propless**, and the block's label default was a
   hardcoded `label = 'Discover'`, so the precedence `o.heroCta || label || copy.hero.cta` resolved to
   the literal `'Discover'` and **`copy.hero.cta` was dead code** — the edited field could never
   render. (Headlines appeared to work only because the live `site_config.heroHeadline` override wins
   *before* the prop.) **Fix:** removed the hardcoded default from `HeroVideo` in all 4 templates so
   the chain falls through to `copy.json` (commit `nanocrew-templates@ae4e122`); same one-line patch
   backfilled into already-provisioned repos (e.g. `store-aether-run`). Forge conditioning hardened:
   the Master `CLAUDE.md` now states **copy is data — `content/copy.json` is the single source; never
   bake a prose default into a component.** The deeper lesson: a generated edit isn't done when the
   build is green — it's done when the changed field actually *renders*.

## The target — a build→refine→publish arc

1. **Build (instant + presentable):** Eve authors a masterful prompt → the conditioned forge robot
   adapts the template, writes real CTAs/copy, and drops in **intentional, on-brand temporary
   imagery** so the site looks finished on day one — already wired to DB + store + fulfilment.
2. **Refine (creator's editorial control):** in the **design generator** the creator makes the real
   products, featured images, and video; these **progressively replace** the temporary imagery.
3. **Publish (go live):** link a domain, push live with **zero placeholders**, a faithful brand,
   and the **store + fulfilment active and mirrored in the Nano Crew app**.

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
