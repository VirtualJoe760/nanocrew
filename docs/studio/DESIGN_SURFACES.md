# Design surfaces — the tab and Eve are one product

Nano Crew has **two ways to make a design**, and creators expect them to be the same product:

| | Surface | Entry |
|---|---|---|
| **Design Center** | `src/app/design.tsx` — the zoomable canvas, the docks, the editor | the Design tab |
| **Eve's design pipeline** | `src/components/eve/eve-design.tsx` — voice-first, start to finish — plus `src/components/eve/eve-assets.tsx` (the ASSETS spoke: site graphics, same voice loop) | speaking to her |

🔴 **A capability added to one must be added to the other, in the same change.** This is the same
rule as the account page across app · site · API ([`ACCOUNT_SURFACE.md`](../accounts/ACCOUNT_SURFACE.md)),
for the same reason: one creator, two front doors, and no licence to drift.

## Where a new capability belongs

The seam already exists — **`src/components/designer/`** holds the pieces both surfaces import:

```
ProductPicker · PlacementEditor · FinalizeSheet     ← imported by BOTH today
```

So the order is: **build it in `src/components/designer/` (and the API route), then surface it in
both.** A capability written directly into `design.tsx` or `eve-design.tsx` is the drift; the tab is
where it usually starts, because it's easier to build a button than a conversation.

Both call the same endpoints — `/api/generate`, `/api/enhance`, `/api/compositions`, `/api/blanks`,
`/api/catalogues` — so parity is nearly always a **surface** problem, not a backend one.

## Parity matrix (2026-08-20)

Taken from the imports and the API calls in each file, not from intent.

| Capability | Design Center | Eve | Notes |
|---|---|---|---|
| Pick the product | ✅ `ProductPicker` | ✅ `ProductPicker` | shared — incl. the technique chip (Embroidered · Knitted · All-over print) |
| Generate from a prompt | ✅ `/api/generate` | ✅ `/api/generate` | shared |
| **Technique-aware generation** | ✅ composition-time adaptation | ✅ `templateKey` at generate + adaptation fallback | `lib/technique.ts`. Eve knows the blank BEFORE generating, so her art is born producible (embroidery ≤6 thread colors, knit ≤4 yarns); the tab generates product-blind and `/api/compositions` adapts at combine. `designs.technique` stops double-adaptation. |
| Technique surfaced to the creator | ✅ picker chip + "Design adapted" alert | ✅ picker chip + she says it at pick and after adaptation | same fact, different verb (Joe, 2026-08-20: "surfaced in both") |
| Enhance the prompt | ✅ "Enhance" | ✅ enhance-or-as-is fork | Eve asks and folds the conversation in as context; the tab is a one-shot button with an effort slider |
| Placement on the garment | ✅ `PlacementEditor` | ✅ `PlacementEditor` | shared |
| Pricing → publish | ✅ `FinalizeSheet` | ✅ `FinalizeSheet` | shared |
| Retouch an existing design | ✅ `DesignEditor` (retouch · text · remix · custom) | ⚠️ "Tell Eve" only | **the widest gap** — she has one freeform path where the tab has four modes |
| Feather (edge soften) | ✅ `PlacementEditor` | ✅ | shared `/api/creator/design-feather`, free |
| **Remove background (cut out)** | ✅ `PlacementEditor` → `/api/edit` | ❌ | drift to close |
| **Clean-up pass (canned refine)** | ❌ | ✅ canned `/api/edit` | drift to close — the tab has no canned pass |
| **Marker region edit** | ✅ "Mark" (strokes → `/api/generate` `marks`) | ❌ | circle an area, the model edits only that region |
| **On-model preview shots (pre-publish)** | ✅ `/api/creator/preview-shots` | ❌ | Combine sheet + composite review; ephemeral, 16cr |
| Site-asset generation + assignment | ✅ Site-assets mode + slot long-press | ✅ `EveAssets` (the ASSETS spoke) | both write `/api/creator/site-assets` |
| **Idea generator** | ✅ `/api/idea` | ❌ | she could riff one aloud |
| **Meme mode** | ✅ | ❌ | |
| **Text / typography** | ✅ "Text" | ❌ | |
| **Upload your own art** | ✅ "Upload" | ❌ | |
| **Merge two designs** | ✅ `/api/merge` | ❌ | |
| **Transparent / filled background** | ✅ toggle | ❌ | she passes `background` at generate time only |
| **Share / export** | ✅ native share | ❌ | |
| **The design library** | ✅ `/api/canvas/:id` (+ `/api/designs` writes) | ❌ | she can't reopen past work |
| **The canvas itself** | ✅ `/api/canvas` | ❌ | may be deliberate — see below |
| Voice loop, spoken review | ❌ | ✅ | the tab is silent by design |

## What is deliberately NOT parity

Parity is about *capabilities*, not *interaction*. Two things should stay different:

- **The canvas.** A zoomable board of nodes is a tap-and-drag idea; Eve's equivalent is the
  conversation itself. Don't build a canvas into her tab to satisfy this doc.
- **Modality.** She leads by voice and asks before opening surfaces; the tab is direct manipulation
  and stays silent. Same capability, different verb.

Everything else on the ❌ list above is drift, and each one is a creator hitting a wall in the
surface they happened to choose.

## When you add something

1. Build it in `src/components/designer/` + the API route.
2. Surface it in **both** `design.tsx` and `eve-design.tsx` — for Eve that usually means a spoken
   offer and a routed intent, not a button.
3. Update the matrix above **in the same change**, including a deliberate ❌ with its reason.
4. If it's a new reusable piece, register it in [`UI_REGISTRY.md`](../context/UI_REGISTRY.md).

Per-screen behaviour for both surfaces: [`docs/app/PAGES.md`](../app/PAGES.md). Her voice rules:
[`EVE_VOICE.md`](EVE_VOICE.md) · her job files: [`src/eve/jobs/design.md`](../../src/eve/jobs/design.md).
