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

## Layout containers must not eat touches

A full-screen `View` (or `KeyboardAvoidingView`) that exists purely to lay children out still takes
`pointerEvents="auto"` by default, so it **swallows every touch on empty space** and anything
beneath it never sees a finger. Give layout wrappers **`pointerEvents="box-none"`** — they lay out,
their children still receive, and taps fall through.

This shipped a broken OTA: three such wrappers sat above Eve's gesture surface, so the new
press-and-hold wheel could never open **and tap-to-talk broke with it**. Neither TypeScript nor the
bundler can catch it; it only shows when a finger (or a click) lands on empty space.

## Breathing room — never full width (Joe, 2026-08-17)
Content never runs edge-to-edge against a border or card boundary — no text or artwork touching
the frame it sits in. This binds GENERATED imagery too: the OG-card transform constrains the
wordmark's width so it can't span the full 1200px canvas (`src/lib/og-image.ts`). If a comp or a
Cloudinary transform puts ink against an edge, it's wrong before the code is.

## Safe areas — never draw into the device chrome
**Joe's rule, and it is a hard one:** nothing we draw may sit under the **Dynamic Island / notch** at
the top or the **home indicator** at the bottom. A zero (or small fixed) top offset on a full-screen
surface isn't "tight" — it is *physically covered by hardware* on most of our install base.

- **Every top-anchored element offsets from `useSafeAreaInsets().top`.** The house pattern is
  `paddingTop: insets.top + Spacing.four` for a screen header, and `insets.top + Spacing.two` for a
  thin bar. Never `top: 0`, `top: 14`, or a bare `paddingTop: 12` on something that reaches the top edge.
- **Every bottom-anchored element offsets from `.bottom`** (or `BottomTabInset` where the tab bar is
  in flow). `Math.max(insets.bottom, Spacing.two)` is the idiom — the tab bar pads its own indicator,
  so don't double it.
- **Reference values, so a comp can be checked by eye:** Island devices ≈ **59pt** top / **34pt**
  bottom; notch devices ≈ 47 / 34; the older flat phones ≈ 20 / 0. If a design puts anything in the
  top ~59pt of the frame, the design is wrong before the code is.
- **Inside `<Modal>` insets don't resolve** — pass the app-level insets in as props (see "Modals /
  sheets" below), or you reintroduce the same bug one layer down.
- **This governs mocks and design comps too.** Draw the Island in the frame so the constraint is
  visible while the layout is being decided, rather than discovered on device.

Hard-rule entry: [`NEVER_VIOLATE.md`](NEVER_VIOLATE.md) §4.

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
