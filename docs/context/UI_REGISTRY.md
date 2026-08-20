# UI Registry

The **living catalogue** of reusable app components — what exists (reuse it) and what's still missing
(build it as a token-driven primitive, don't one-off it). The behavioral rules are in
[`UI_RULES.md`](UI_RULES.md); tokens in [`UI_TOKENS.md`](UI_TOKENS.md).

> 🟡 **Add a row here whenever you create or promote a reusable component** — a never-violate process
> rule ([`NEVER_VIOLATE.md`](NEVER_VIOLATE.md) §6), checked by hand before commit (the automated sync
> checks do not cover it).

## Primitives — reuse these

| Component | File | Key props | Notes |
|---|---|---|---|
| `ThemedText` | `themed-text.tsx` | `type`, `themeColor`, `glow` | All text. `type`: default · small · smallBold · subtitle · title · link · linkPrimary · code |
| `ThemedView` | `themed-view.tsx` | `type` (ThemeColor), `lightColor`, `darkColor` | All colored surfaces |
| `GlowButton` | `glow-button.tsx` | `label`, `onPress`, `variant` (primary/secondary/ghost), `disabled`, `loading`, `style` | The standard button — never style a bare Pressable |
| `GlowInput` | `glow-input.tsx` | `…TextInputProps`, `containerStyle`, `style` | The standard text input — never use a bare TextInput |
| `DesignTile` | `design-tile.tsx` | `color`, `label`, `style` | Square brand-tinted tile w/ label (design canvas) |
| `GarmentMockup` | `designer/garment-mockup.tsx` (+ `.web`) | `garmentUri`, `designUri`, `rect`, `blend` | Supplier-agnostic "printed" mockup (Skia native / CSS-blend web) |
| `EveGlyph` | `eve/eve-glyph.tsx` | `size` | Eve's static neural-constellation mark (SVG, no GL) — use wherever the old NC monogram orb appeared |
| `EveWheel` | `eve/eve-wheel.tsx` | `x`, `y`, `active`, `hasBrand`, `brandsKnown`, `talking`, `micDenied` | Eve's press-and-hold radial menu. Nine sectors evenly spaced at 40° (TALK stays at top; EDIT inserted after BRANDS — Joe, 2026-08-19); presentational only (the gesture lives in `eve-home`). Exports `spokeAt(dx,dy)` so the hit test and the highlight share one definition |
| `Collaborators` | `collaborators.tsx` | `visible`, `onClose`, `stores` | Account → brand collaborator management (invite/revoke/remove) |
| `withScreenFade` | `screen-fade.tsx` | `(Screen, { background \| eveThrough \| eveThrough:'clear' })` | Screen-transition HOC wrapping account/design/market/studio/reset-password; also exports `EVE_SCRIM` |
| `SquareCarousel` | `square-carousel.tsx` | `images`, `size`, `accent`, `radius` | Square swipe carousel (brand-store, product-detail) |
| `GradientSlider` | `gradient-slider.tsx` | `id`, `stops`, `value`, `onChange` | Gradient-track 0..1 slider (brand-review, site-editor) |
| **Designer seam** | `designer/` — `DesignEditor`, `DesignCanvas`, `PlacementEditor`, `ContentDock`, `TemplatesDock`, `WebAssetsDock`, `ProductPicker`, `ProductDetailSheet`, `FinalizeSheet` | — | The shared design surface used by BOTH `design.tsx` and `eve/eve-design.tsx` — the parity seam [`CLAUDE.md`](../../CLAUDE.md) mandates building into first. See [`DESIGN_SURFACES.md`](../studio/DESIGN_SURFACES.md) |

## Chrome — Studio surface helpers (`nc-screen.tsx`)
| Component / hook | Props | Notes |
|---|---|---|
| `usePalette()` | — | The screen palette (`accent`, `ink`, `accentCool`, `dim`, `faint`, `line`, …) |
| `NCMark` | `size`, `color` | The NC brand mark (tinted logo asset) |
| `NCHeader` | `label`, `p` | Standard page header: mark + uppercase label |
| `FabricBackground` | `p` | The monochrome silk/wave backdrop |

Hooks: `useTheme()` (ColorScheme → `Colors`), `useColorScheme()` (pinned dark), `useStudioPalette()`
(modal palette), `useAuth()` (`hooks/use-auth.ts` — Supabase session + loading), `useLiveVoice()`
(`hooks/use-live-voice.ts` — Eve's live voice session state/transcripts). Currently **UNUSED**
(candidates for deletion — check before reviving): `HintRow` (`hint-row.tsx`), `WebBadge`
(`web-badge.tsx`), `SectionScreen` (`section-screen.tsx`).

## Shared behaviour — not components, but reuse them anyway

| Export | Where | Use it for |
|---|---|---|
| `tabBarSpace(bottomInset)` | `components/app-tabs.tsx` | Bottom padding for any **full-screen surface that draws under the tab bar**. The bar is absolutely positioned, so the safe-area inset alone is ~37pt short and controls get cut in half (Joe, 2026-08-19: "the eve icon is being cut off"). `TAB_BAR_CONTENT_HEIGHT` is the bar's own height above the inset. |
| `useSpokenText(text, window, speaking)` · `tailWords(text, n)` | `lib/caption.ts` | **Any subtitle of Eve's speech.** Her transcript arrives seconds ahead of her audio, so rendering `venusText` directly races her voice; this reveals words across the wall-clock window of her queued audio (`live.speechWindow`). `tailWords` trims to a caption line rather than a paragraph. |

## Missing — build as token-driven primitives (don't one-off)
These are re-implemented per-screen today; promoting them removes the biggest duplication. Building
them is part of the **UI component system** in-flight work — do it opportunistically.

| Needed | Why (current duplication) |
|---|---|
| **`Sheet`** (modal wrapper) | The `<Modal>` + backdrop + SafeAreaView-inset pattern is copy-pasted in ~10 surfaces (design, studio-composer, collaborators, go-live, returns, purchases, site-editor, cockpit, …) |
| **`Card`** | ~10 hardcoded card layouts (earnings, plans, orders, claims) — only `DesignTile` is shared |
| **`Pill` / `Chip`** | Toggle/tag patterns inline (buy tag, store selector, tab switcher) |
| **`IconButton`** | Emoji-glyph + label buttons hardcoded with white glyph + shadow (feed actions) |
| **`EmptyState`** | Each screen renders its own "nothing here yet" text |
| **`LoadingState`** | ~8 ad-hoc `ActivityIndicator` + text combos |
| **`Segment` / `Tabs`** | Pill-row tab/segment selectors repeated (studio-composer) |

## Storefront components are a separate track
The Next.js **storefront templates** have their own component system (shared blocks, forge-composed) —
that's [`../storefront/COMPONENT_SYSTEM.md`](../storefront/COMPONENT_SYSTEM.md), not this registry.
Same philosophy (reuse blocks, don't reinvent), different stack. The forge robot is being conditioned
toward that block system as a follow-up.
