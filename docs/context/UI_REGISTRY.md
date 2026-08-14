# UI Registry

The **living catalogue** of reusable app components — what exists (reuse it) and what's still missing
(build it as a token-driven primitive, don't one-off it). The behavioral rules are in
[`UI_RULES.md`](UI_RULES.md); tokens in [`UI_TOKENS.md`](UI_TOKENS.md).

> 🟡 **Add a row here whenever you create or promote a reusable component** — auto-review flags a new
> reusable `src/components/*` that isn't registered (a never-violate process rule).

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

## Chrome — Studio surface helpers (`nc-screen.tsx`)
| Component / hook | Props | Notes |
|---|---|---|
| `usePalette()` | — | The screen palette (`accent`, `ink`, `accentCool`, `dim`, `faint`, `line`, …) |
| `NCMark` | `size`, `color` | The NC brand mark (tinted logo asset) |
| `NCHeader` | `label`, `p` | Standard page header: mark + uppercase label |
| `FabricBackground` | `p` | The monochrome silk/wave backdrop |

Hooks: `useTheme()` (ColorScheme → `Colors`), `useColorScheme()` (pinned dark), `useStudioPalette()`
(modal palette). Niche but reusable: `HintRow` (`hint-row.tsx`), `WebBadge` (`web-badge.tsx`),
`SectionScreen` (`section-screen.tsx`, scaffold for unbuilt tabs).

## Missing — build as token-driven primitives (don't one-off)
These are re-implemented per-screen today; promoting them removes the biggest duplication. Building
them is part of the **UI component system** in-flight work — do it opportunistically.

| Needed | Why (current duplication) |
|---|---|
| **`Sheet`** (modal wrapper) | The `<Modal>` + backdrop + SafeAreaView-inset pattern is copy-pasted in ~5 screens (feed, brand-store, product-detail, paywall, …) |
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
