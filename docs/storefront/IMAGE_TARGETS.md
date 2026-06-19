# Image targets — the `data-nano-image` contract

So a creator can **circle any image on their live site and change it**, every template tags its
images with a `data-nano-image` attribute. The app's WebView hit-test
([site-preview.tsx](../../src/components/site-preview.tsx) `hitScript`) reads this attribute when a
circle lands on an image, so the system knows *which* image was pointed at — not just where.

## The attribute

Put `data-nano-image="<target>"` on (or wrapping) every image element a creator could want to change.
It may sit on the `<img>`/`<picture>` itself, or on the nearest ancestor (the hit-test climbs to find it).

| `data-nano-image` value | What it is | Change routes to |
|---|---|---|
| `hero` | the big full-bleed image at the top | `site-assets` → `site_assets.hero.imageUrl` |
| `logo` | the brand logo | `site-assets` → `stores.logo_url` |
| `og` | the social/share card image | `site-assets` → `site_assets.og` |
| `section:<key>` | a named in-page image (`section:about`, `section:banner`) | `site-assets` → `site_assets.sections[key]` |
| `product:<id>` | a product photo (id = the product's id) | generate → `products.image_url` (+ Printful re-sync) |

`<key>` matches `[a-z0-9_-]{1,40}`. Use stable, human keys (`about`, not `img3`) — they show up when
Venus names the target ("the about section image") and disambiguates if a circle catches two.

## How a template reads the value back

The same map a template already reads for the hero applies to sections:

```ts
// site_assets: { hero?: { imageUrl }, og?, sections?: Record<string,string> }
const aboutImg = siteAssets?.sections?.about ?? FALLBACK_ABOUT_IMG;
```

Render `<img data-nano-image="section:about" src={aboutImg} />`. A creator-set section image then
beats the template default with no rebuild (same `live ?? placeholder` pattern as the hero).

## Routing summary (the two destinations)

A circled target feeds **both** edit paths — the intent decides which:
- *"make it a different picture"* → generate + place via `/api/creator/site-assets` (the slots above). **Direct, instant.**
- *"make it behave/restructure"* (parallax, "turn into a carousel + add 2 images") → the **forge** edits
  that element's code, handed the target identity + any images generated for it. See
  [studio/EDIT_PIPELINE.md](../studio/EDIT_PIPELINE.md).

## The screenshot is the primary proof

Discernment of *which* element a creator means is driven by a **real screenshot of the page + their
mark** (circle, arrow, underline — whatever they drew), captured on-device (`react-native-view-shot`,
in `site-preview.tsx`) the instant the mark lands, hosted on Cloudinary by `/api/creator/revise`, and
handed to Claude on the forge (downloaded into `briefs/screenshots/`). Claude reads a marked-up
screenshot far more reliably than coordinates. The `data-nano-image` attribute and the DOM hit-test
are **hints layered on top** — useful for an instant direct swap — not the primary mechanism. If
capture fails, the forge falls back to re-rendering the strokes onto a fresh Playwright screenshot.

## Status
- ✅ `site-assets` write path supports `hero/logo/og/cover/section:<key>`.
- ✅ hit-test detects images + reads `data-nano-image`.
- ✅ real screenshot capture → host → forge (with stroke-render fallback). **Needs a build (native lib) + a worker redeploy.**
- ⏳ tag all 5 templates (`minimal/bold/elegant/extravagant/street`) — now optional (hint only).
- ⏳ plan→forge target plumbing for structural edits; `product:<id>` generation route.
