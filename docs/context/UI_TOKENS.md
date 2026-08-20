# UI Tokens

The single reference for the app's design tokens. **Tokens live in code** (three files — see below);
this doc maps them so you reuse a token instead of hardcoding a hex or a pixel value. Brand
*storefronts* keep their own colors — this is the **app chrome** only (cool monochrome + platinum
silver, no gold).

> 🔴 **The palette lives in THREE files that must stay in sync** (a never-violate rule). Edit one,
> edit all three. See [`NEVER_VIOLATE.md`](NEVER_VIOLATE.md) §3.

## The three sources — and which to use

| File | Export | Used by | Access |
|---|---|---|---|
| `src/constants/theme.ts` | `Colors` (light/dark), `Fonts`, `Spacing` | App chrome, `ThemedText`/`ThemedView` via `useTheme()` | `useTheme()` → `theme.text`, `theme.background`, … |
| `src/components/nc-screen.tsx` | `makePalette()` | The Eve/Studio screen + Eve surfaces (eve-home, eve-design, interview, welcome) + `GlowButton`/`GlowInput` (Design/Market/Account read `Colors` via `useTheme()`) | `usePalette()` → `p.accent`, `p.ink`, `p.accentCool`, … |
| `src/lib/studio-palette.ts` | `makeStudioPalette()` | Studio modals (dashboard, composer, paywall, cockpit) | `useStudioPalette()` → `sp.surface`, `sp.card`, … |

Consolidating the last two onto one palette is a known follow-up; until then, keep all three aligned.

## Colors (`Colors`, theme.ts)
| Token | Dark | Light | Use |
|---|---|---|---|
| `text` | `#f4f4f6` | `#131316` | primary ink |
| `textSecondary` | `#ebedf1` | `#6a6c73` | secondary text (near-white on dark — no grey) |
| `background` | `#08080a` | `#f5f5f6` | screen background |
| `backgroundElement` | `#161619` | `#ffffff` | cards lifting off the background |
| `backgroundSelected` | `#232327` | `#e9e9ec` | selected/pressed surface |
| `tint` | `#cdd1d9` | `#44474e` | the platinum-silver accent |
| `canvas` / `canvasDot` / `canvasEdge` | `#121319` / `#34374a` / `#23242e` | `#E9EAEF` / `#B9BCC8` / `#D4D6DE` | the Designer work-surface |

The screen palette (`usePalette`) adds: `accent`/`accent2` (platinum), **`accentCool`** (`#7cc7df`/`#2f7d8f`
— the cool input-focus hue, deliberately ≠ the platinum button glow), `dim`, `faint`, `line`, `wave[]`.

## Spacing (`Spacing`, theme.ts)
`half: 2 · one: 4 · two: 8 · three: 16 · four: 24 · five: 32 · six: 64`. Use these; don't invent margins.

## Type (`ThemedText` `type=` + `Fonts`)
Font is **Jost** (bundled), mapped by weight: Light 300 = body/`small`/`default`, Regular 400 =
`title`/`subtitle`/headings, Medium 500 = `smallBold`/buttons.

| `type` | size / line-height | weight | Use |
|---|---|---|---|
| `default` | 16 / 24 | Light | body |
| `small` | 14 / 20 | Light | dense body, captions |
| `smallBold` | 14 / 20 | Medium | emphasis, button labels |
| `subtitle` | 32 / 44 | Regular | section heads |
| `title` | 48 / 52 | Regular | screen titles |
| `link` / `linkPrimary` | 14 / 30 | Light | links (`linkPrimary` = tint color) |
| `code` | 12 | Jost mono | eyebrows / uppercase labels (`letterSpacing: 2, uppercase`) |

## Glow
The depth motif is the **nano-glow** (`src/constants/glow.ts` → `glow()` / `textGlow()`): platinum on
buttons/text, a cooler hue (`accentCool`) on inputs. Use the helper, don't hand-roll shadows.

> Touch a token? Update this doc in the same change ([`NEVER_VIOLATE.md`](NEVER_VIOLATE.md) §6).
