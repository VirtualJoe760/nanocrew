---
description: Front-end test of both design surfaces — generate on real products, prove the technique/placement safeguards hold, and check the tab and Eve stayed in parity.
argument-hint: [full | technique | parity | "a product or capability to check"]
---

You are testing the **design surfaces** in the Nano Crew repo. Requested run: **$ARGUMENTS**
(no argument → `full`).

There are two of them and they are one product — the **Design Center** (`src/app/design.tsx`) and
**Eve's design pipeline** (`src/components/eve/eve-design.tsx`, plus `eve-assets.tsx` for site
graphics). The parity rule and the live matrix are in
[`docs/studio/DESIGN_SURFACES.md`](../../docs/studio/DESIGN_SURFACES.md).

This is a **front-end test**: drive the real UI, make real designs on real products, and prove the
production safeguards hold. Not a doc review.

## The thing that matters most: not every product is printable art

`src/lib/technique.ts` is the source of truth. A design that's fine on a tee is unmakeable on a cap
or a sweater, and the creator must be stopped **early** — at generation and at combine — not at
publish with a raw Printful 502.

| Technique | Product | What must be true |
|---|---|---|
| **DTG / DTFILM / UV** | tee, hoodie | full-colour art prints as-is; front/back/sleeve placements |
| **EMBROIDERY** | caps, some apparel | stitched thread — bold shapes, **≤6 solid colours**, no gradients, no photo detail, and **no fake thread texture drawn into the art** |
| **KNITWEAR** | sweaters | jacquard yarn — flat solid shapes, very few colours, no fine detail |
| **CUT-SEW / SUBLIMATION (AOP)** | all-over print | panel placements (`front_dtfabric`, …) — plain `front` is **not** printable |

Run each class at least once. For every one, check all three layers:

1. **Generation is born producible.** Eve knows the blank *before* generating, so her art should
   already obey the constraint. The tab generates product-blind and adapts at combine — confirm the
   adaptation actually happens, and that `designs.technique` stops it happening twice.
2. **The creator is told, in both surfaces.** The picker shows the technique chip; the tab alerts
   "Design adapted"; Eve *says* it at pick and again after adapting. Same fact, different verb — if
   one of them is silent, that's the bug.
3. **The API refuses the impossible, early.** This is the safeguard:

```bash
# A placement the blank cannot print must 422 with the allowed list — never reach publish.
curl -s -X POST http://localhost:8081/api/compositions \
  -H "Content-Type: application/json" \
  -H "x-internal-key: $INTERNAL_API_KEY" -H "x-internal-creator: <creator-id>" \
  -d '{"catalogueId":"<id>","designId":"<id>","templateKey":"<aop-blank>","placement":"front"}'
# expect 422 "This product can't print front — it prints front_dtfabric, back_dtfabric"
# then the blank's real placement key → 200
```

Regressions to watch for specifically: a composition accepted and only failing at publish
(`502 Printful 400: Incorrect file type`); an adapted design that the surface never shows, leaving
`PlacementEditor` empty because it hydrates from the server composition's new `designId`.

## Then walk the UI, both surfaces

Take one design the whole way on each side: **pick brand → pick product → generate → review tools →
placement → pricing → publish**, and check what a creator would notice —

- the **brand** is the one they chose (never silently the oldest);
- review tools do what they say (clean-up, feather, remove background, marker region edit);
- placement: drag, resize, the DPI readout, and the print-area guides;
- publish: colours default sensibly, the price isn't the bare minimum, the product lands in the
  right store and shows a real image on the storefront (`api/store/<slug>` — blank images must be 0);
- **Eve's side is voice-first** — she offers and then opens a surface; she should never land the
  creator in a bare form.

Rules: **never complete a purchase** on any storefront. Use a throwaway brand, prefix products
`TEST-`. Generation and publishing costs don't matter.

## Parity pass

Derive it from the code, not from the matrix — the matrix is what you're checking:

```bash
grep -n "from '@/components/designer" src/app/design.tsx src/components/eve/eve-design.tsx
grep -o "api/[a-z-]*" src/app/design.tsx | sort -u
grep -o "api/[a-z-]*" src/components/eve/eve-design.tsx | sort -u
```

⚠️ `src/components/designer/` holds **both** shared pieces and tab-only ones (`DesignCanvas`,
`DesignEditor`, `ProductDetailSheet`). Location is not the test — **imports are**. Diff the two
lists, subtract what's deliberately not parity (the canvas; modality itself), and what remains is
drift.

## Report

- Update the matrix in `DESIGN_SURFACES.md` where it no longer matches reality, in the same change.
- File new defects in [`docs/ops/BUG_AUDIT_2026-08-20.md`](../../docs/ops/BUG_AUDIT_2026-08-20.md)
  with status · where · what · evidence.
- A safeguard failure (art placed where it cannot be produced) is **major or critical** — it reaches
  a real customer as a broken order, not a cosmetic bug.
- If you fix anything, the docs ride the same commit ([`CLAUDE.md`](../../CLAUDE.md)).

Driving the UI: [`src/eve/testing/ui-driving.md`](../../src/eve/testing/ui-driving.md). Testing her
voice side: `/eve-test`.
