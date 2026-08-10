# Studio

The creator-facing half of Nano Crew: a creator **talks to Eve** → a brand + Printful shop +
storefront website get **generated** → the creator **refines** the site with real products, model
shots, and scene video in the design generator → **publishes** (domain, go-live, store + fulfilment
active, mirrored in the app).

This division owns the *creator's* journey. The companion **`docs/storefront/`** division owns the
*machinery* underneath it (templates, the forge, provisioning, the data contract). Where the two
meet — "Eve talks to the forge robot" and "design-generator assets reach the live site" — this
division references the storefront docs rather than duplicating them.

## The docs

| Doc | Covers |
|---|---|
| **[BUILD_FLOW.md](BUILD_FLOW.md)** | The end-to-end build → refine → publish arc from the creator's POV. The narrative spine; links out to the mechanics. **Honest about CURRENT vs TARGET.** |
| **[FORGE_AI.md](FORGE_AI.md)** | THE doc on how our AI talks to the forge robot — the heart of a live quality effort. How the brief is generated today (a code mail-merge), what conditions the robot (almost nothing), where failures get swallowed, and the planned fixes. |
| **[DESIGN_GENERATOR.md](DESIGN_GENERATOR.md)** | The Design tab + generator: making products (Printful publish), model shots, and scene video — and how those assets flow to the storefront, replacing the temporary placeholders the forge ships. |

## Read these alongside

- [`docs/storefront/STOREFRONT_ENGINE.md`](../storefront/STOREFRONT_ENGINE.md) — how a site is built and revised (templates, forge, provisioning queue).
- [`docs/storefront/STOREFRONT_DATA_CONTRACT.md`](../storefront/STOREFRONT_DATA_CONTRACT.md) — how a live site reads its catalogue + how published assets reach it.
- [`docs/storefront/BUILD_QUALITY.md`](../storefront/BUILD_QUALITY.md) — the evidence + root-cause for why builds look weak today, and the target arc. FORGE_AI.md and BUILD_FLOW.md both lean on it.

## State (2026-06-15)

The whole arc is code-complete and live, **but build quality is the open problem.** Today the
forge ships a barely-configured template (blank hero, stock placeholders) because the brief is a
mail-merge and the robot is unconditioned. The refine + publish steps work. The fix — Eve authors
a masterful prompt, a Master `CLAUDE.md` conditions the robot, the robot gets eyes — is captured in
[FORGE_AI.md](FORGE_AI.md) and [`docs/storefront/BUILD_QUALITY.md`](../storefront/BUILD_QUALITY.md).
