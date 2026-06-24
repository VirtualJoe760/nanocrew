# UI Rules

The behavioral design system: *how* to build UI here so it stays consistent and we stop writing
one-off components. Tokens are in [`UI_TOKENS.md`](UI_TOKENS.md); the catalogue of what exists is
[`UI_REGISTRY.md`](UI_REGISTRY.md).

## Reuse the primitives + tokens everywhere; custom screens are fine
This app is **deliberately custom** — most screens are bespoke, and that's expected. So the reuse bar
is **not** "compose every screen from shared blocks." It's narrower and worth holding:

1. **Reuse the primitives + tokens — always.** Standard buttons → `GlowButton`, standard inputs →
   `GlowInput`, all text → `ThemedText`, all surfaces → `ThemedView`, and colors/spacing/type from
   [`UI_TOKENS.md`](UI_TOKENS.md). A bare `<Pressable>` styled as a *standard* button, or a hardcoded
   hex/margin a token covers, is the thing to avoid — not bespoke layout.
2. **Composite reuse concentrates in the Market.** Product cards, brand cards, storefront grids — the
   shopping surfaces — are where a shared `Card`/`Sheet` actually pays off (the [`UI_REGISTRY.md`](UI_REGISTRY.md)
   "missing" list is aimed mostly there). Elsewhere, build what the screen needs.
3. **If you copy the same composite markup a 3rd time, promote it** and add it to the registry — but
   don't force-fit a shared component onto a one-of-a-kind screen just for the principle.

## Buttons → `GlowButton`
Never style a bare `<Pressable>` as a button. `GlowButton` (`src/components/glow-button.tsx`) is the
standard, with three weights:
- `primary` — filled platinum, strong halo (the main CTA)
- `secondary` — outlined, soft halo
- `ghost` — text only (tertiary / decline)

It handles press-scale, the glow, `disabled`, and `loading` for you. Pass `label` + `onPress`.

## Inputs → `GlowInput`
Never use a bare `<TextInput>`. `GlowInput` (`src/components/glow-input.tsx`) carries the cool
nano-glow, kills the web focus outline, and brightens on focus. `containerStyle` lays out the wrap
(margins/width); `style` styles the field.

## Text & containers → `ThemedText` / `ThemedView`
All text is `ThemedText` with a `type` (see [`UI_TOKENS.md`](UI_TOKENS.md)) — never a raw `<Text>`
with hardcoded font/size. All colored surfaces are `ThemedView type="…"`.

## Readability is non-negotiable
Never light-on-light or dark-on-dark. Use `text`/`textSecondary` against `background`/`backgroundElement`;
over an image or video, dim the media (scrim/gradient) so words stay legible. Don't color text with a
raw brand hue that can vanish into the background.

## Spacing & layout
Use the `Spacing` scale (`half`→`six`) for every margin/padding/gap — no magic numbers. Respect
`MaxContentWidth` (800) for wide layouts and `BottomTabInset` above the tab bar.

## The two glows are intentional
Buttons glow **platinum** (`accent`); inputs glow **cool** (`accentCool`). A focused field must read
differently from a CTA — don't unify them.

## Modals / sheets
The recurring pattern is a `<Modal>` over a `modalBackdrop` with a `sheet`, and a manual SafeAreaView
inset (`Math.max(insets.top, Spacing.three)`) because insets don't resolve inside `Modal`. This is
copy-pasted across ~5 screens — a shared `Sheet` wrapper is a **missing primitive** (see the registry).
Until it exists, match the existing pattern rather than inventing a new modal shape.

## Adopt opportunistically (don't mass-rewrite)
You don't have to convert all 220 Pressables at once. When you touch a screen for any reason, swap its
bare buttons/inputs for the primitives as you go. Pair this with bug-fix work.
