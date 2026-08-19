# Nano Crew brand assets

The identity is **Eve's constellation** — a cyan node-and-spoke glyph on the app's near-black —
adopted 2026-08-16. It replaced the serif "NC" monogram, and the monogram is retired everywhere.

Everything here is **generated from vectors**, not designed in a file. One script owns the geometry
and every slot regenerates pixel-perfect at any size:

```bash
node scripts/gen-app-icon.mjs
```

## The glyph lives in four places, and they must agree

| Where | What it is |
|---|---|
| `src/components/eve/eve-glyph.tsx` | the in-app mark (the canonical `NODES` / `MIDS` arrays) |
| `scripts/gen-app-icon.mjs` | the same arrays, verbatim — renders every raster asset |
| `nanocrew-site/app/eve-mark.tsx` | the same arrays again, for the web nav |
| `nanocrew-site/app/opengraph-image.tsx` | the same arrays, for the social share card |

**Change the glyph in one, change it in all four.** There is no shared module — React Native, a
Node script, and two `next/og` surfaces can't import the same file — so this table is the contract.

## Colour

Taken from `src/constants/theme.ts`, mirrored into `nanocrew-site/app/globals.css`. Cool monochrome
plus one accent. **No gold, no warm neutrals** — the old identity was warm and none of it survives.

| Token | Hex | Use |
|---|---|---|
| ground | `#08080a` | every dark surface, the icon's own field |
| surface | `#131317` | cards; `#101015` in email, one step off the ground |
| edge | `#212127` | hairlines |
| text | `#f4f4f6` | primary |
| dim | `#8b909b` | secondary |
| platinum | `#cdd1d9` | the app's UI accent |
| **Eve blue** | `#7fd7e6` | the glyph itself, and the accent on outward-facing surfaces (email, social) |

In the **app**, Eve blue appears only where Eve herself does. **Outward** — email and the share card
— it is the brand accent, because the glyph is the logo and the logo is blue (Joe, 2026-08-19).

## Typeface

**Jost**, everywhere. Self-hosted in the app (`assets/fonts`) and on the site
(`nanocrew-site/app/fonts`, via `next/font/local`).

Email is the exception: there is no bundler in an inbox, so the template links Google Fonts and
declares a real fallback stack. Apple Mail and iOS honour it; Gmail and Outlook land on the stack.
That is the one place a font CDN is allowed.

## Generated assets

Written by `scripts/gen-app-icon.mjs`. Don't hand-edit them — regenerate.

| File | Size | Consumed by |
|---|---|---|
| `assets/images/icon.png` | 1024 | the iOS app icon (`app.json`) |
| `assets/brand/app-icon-1024.png` | 1024 | App Store listing |
| `assets/brand/play-store-icon-512.png` | 512 | Play Store listing |
| `assets/images/favicon.png` | 196 | app web favicon |
| `assets/images/android-icon-{foreground,background,monochrome}.png` | 1024 | Android adaptive icon |
| `assets/images/splash-icon.png` | — | splash |
| `assets/brand/eve-boot.png` | 1024×1536 | the launch loader (`animated-icon.tsx`, expo-splash-screen) |
| `nanocrew-site/public/brand/nanocrew-mark.png` | 240 | **the masthead in every Nano Crew email** |
| `nanocrew-site/public/brand/nanocrew-avatar.png` | 512 | **the sender profile photo** (see below) |

The last two are written straight into the site's public dir because email clients can't read a repo
and won't render SVG — they need a raster at a stable public URL:

- `https://nanocrew.app/brand/nanocrew-mark.png`
- `https://nanocrew.app/brand/nanocrew-avatar.png`

`platform-api/lib/notify.ts` points `PLATFORM_STORE.logoUrl` at the first one. It used to point at
`nanocrew-site/public/nc-icon.png` — the retired June monogram — which is why emails carried the old
icon until 2026-08-19.

## The sender profile photo

The avatar beside "Nano Crew" in an inbox is **not** set by our HTML — the mail client resolves it
from the sending domain's own profile. Upload `nanocrew-avatar.png` wherever the sending address is
administered (Google Workspace profile photo for a Gmail-hosted address; a Gravatar for the address
otherwise). Until that's done the client falls back to a letter avatar, no matter what the email
body contains.

## Rendered surfaces, not files

Some brand imagery has no binary at all — it's rendered on request, so it can never go stale:

- `nanocrew-site/app/opengraph-image.tsx` — the 1200×630 share card (`twitter-image.tsx` re-exports
  it, so this one file is every social preview). Edit the JSX, not an asset.
- `platform-api/lib/email-templates.ts` — the email shell: dark ground, Eve blue hairline and CTA,
  centred mark, Jost. A brand's own emails keep that brand's palette; only Nano Crew's wear this.

## Legacy

`nc-mark.png`, `nc-symbol.png`, `primary-logo.png`, `nano-crew-logo.png`, `app-icon-source.png`,
`venus-portrait.png` and `nanocrew-site/public/nc-icon.png` are the **retired** monogram/Venus era.
Nothing should reference them. They're kept only as history — if you're reaching for one, you want
the generator instead.
