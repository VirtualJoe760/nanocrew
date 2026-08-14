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
| **[EVE_CONTROL.md](EVE_CONTROL.md)** | **The division's current center of gravity** — THE PIVOT: Eve as the app's persistent living background + control surface, the capability tree, and the P3′ voice design loop. Code comments point here for the current architecture. |
| **[BUILD_FLOW.md](BUILD_FLOW.md)** | The end-to-end build → refine → publish arc from the creator's POV. The narrative spine; links out to the mechanics. **Honest about CURRENT vs TARGET.** |
| **[FORGE_AI.md](FORGE_AI.md)** | THE doc on how our AI talks to the forge robot — Eve authors the brief (gemini-2.5-pro in `provision.ts`; mail-merge only as fallback) and the Master `CLAUDE.md` conditions the robot on every build; the remaining gap is eyes + a real quality gate. |
| **[DESIGN_GENERATOR.md](DESIGN_GENERATOR.md)** | The Design tab + generator: making products (Printful publish), model shots, and scene video — and how those assets flow to the storefront, replacing the temporary placeholders the forge ships. |
| [EDIT_PIPELINE.md](EDIT_PIPELINE.md) | The live-site edit flow (voice → plan → generate → place → forge), its 5 checkpoints, and how to trace a failed edit in logs + DB. |
| [GEMINI_LIVE.md](GEMINI_LIVE.md) | The live-voice stack — Eve on Gemini Live realtime speech-to-speech (`live-voice.ts` + `use-live-voice.ts`, ephemeral token, `/api/say`). SHIPPED. |
| [VENUS_CENTRAL.md](VENUS_CENTRAL.md) | The "Eve as the operating system" game plan (2026-07-05) — the grounded inventory + phase plan behind the pivot; EVE_CONTROL.md carries the current state. |
| [FORGE_DIVERSITY.md](FORGE_DIVERSITY.md) | Why every generated site looks the same — the root causes (fonts pipeline, template/hero inventory, forge latitude) + the fix tracks. Continuation of FORGE_AI.md. |
| [VENUS_AVATAR.md](VENUS_AVATAR.md) | Eve's avatar — the persistent orb/nucleus embodiment (the wireframe-face POC was retired), formant lip-sync, the shader/native gotchas, and the Eve Lab. |

## Read these alongside

- [`docs/storefront/STOREFRONT_ENGINE.md`](../storefront/STOREFRONT_ENGINE.md) — how a site is built and revised (templates, forge, provisioning queue).
- [`docs/storefront/STOREFRONT_DATA_CONTRACT.md`](../storefront/STOREFRONT_DATA_CONTRACT.md) — how a live site reads its catalogue + how published assets reach it.
- [`docs/storefront/BUILD_QUALITY.md`](../storefront/BUILD_QUALITY.md) — the evidence + root-cause for why builds look weak today, and the target arc. FORGE_AI.md and BUILD_FLOW.md both lean on it.

## State (2026-08-14)

The whole arc is code-complete and live. Two of the three quality fixes have **shipped**: Eve
authors the build brief (`authorBrandBrief()` on gemini-2.5-pro in `src/lib/provision.ts`; the old
mail-merge survives only as the no-API-key fallback) and the Master `CLAUDE.md`
(`forge-worker/forge-CLAUDE.md`) conditions the robot on every build. The refine + publish steps
work. The remaining gap — the robot gets eyes + a real quality gate — is captured in
[FORGE_AI.md](FORGE_AI.md) and [`docs/storefront/BUILD_QUALITY.md`](../storefront/BUILD_QUALITY.md).
Since then, the **Eve pivot** ([EVE_CONTROL.md](EVE_CONTROL.md)) reframed the creator-facing half of
this division: Eve is the app's persistent background and the Eve tab is her voice surface.
