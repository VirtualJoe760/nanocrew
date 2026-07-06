# EVE — AI-to-UI CONTROL (grounded build plan)

> Companion to `VENUS_CENTRAL.md`. This is the plan for the *greater vision*: Eve as the app's
> central, morphing control surface, grounded against a full codebase inventory (2026-07-05).
> Current state: **Phase A + B shipped** — the full-screen overlay, home (interview moved in), the
> `developing` site-edit state, and the intent router (`/api/eve/route`). `design` is typed but
> renders `home`.

## The model (settled with Joe)

- **The app is a decision tree of capabilities.** Two front-ends compile to the SAME tree: an
  **energy-orb UI** that blooms from Eve's net (tap to act, drag-through to traverse) and **voice**
  (name any path directly). Isomorphic — one instruction set, two ways in.
- **Node kinds:** `branch` (blooms more orbs) · `pick` (opens a real selection screen, returns a
  value) · `prompt` (Eve asks free input) · `act` (fires a capability).
- **Callable components.** Screens/selectors become addressable capabilities (params in, result
  out). The seeds already exist — `design-bus`, `eve-bus`, deep-links.
- **One persistent 3D canvas.** Workflows are **camera-less net reshapes** (damped uniforms +
  the `venus-orb-bus` shape morph), not page swaps. Heavy tools stay 2D RN surfaces revealed per
  stage.
- **Session:** pull down resumes or greets; swipe up pauses; cold relaunch = fresh.
- **Navigation:** Eve = the verb layer; the tabs stay as the browsable noun layer (both drive one
  state; neither is required).

## The registry is the spine

Today the choice logic is **triplicated**: `venus-guide.ts` (chips), the `/api/eve/route` intent
enum + prompt, and `eve-home`'s `routeTurn` switch. One hand-authored `src/lib/eve-capabilities.ts`
collapses them into a single source that BOTH the orbs and voice dispatch read. Build it first — it
de-duplicates before the rest multiplies.

Entry shape:
```ts
{ id, label, kind, icon, when(ctx), action(ctx), voiceIntent?, pose? }
```
`when` absorbs venus-guide's store-status logic; `action` returns a descriptor `eve-home` interprets
(build-brand / edit-site / new-design / write-post / nav); `voiceIntent` links a `/api/eve/route`
intent to the node; `pose` (later) is the per-node net reshape.

## Capability tree — status

~55 nodes; the large majority are **already callable** (routes/buses exist). The concentrated work:
- `pick` selection handshakes (see below).
- URL-addressability of second-level nouns (Account sub-sections are local `useState`, not routable).
- Product lifecycle gaps: **there is no creator route to unpublish or edit price/details** — delete
  is the only product write today. Build those when a tree node needs them.
- New routes: `GET /api/creator/sales-series` (units live in `order_items.quantity`, untouched),
  `POST /api/venus/draft-post`, post `scheduledAt` + cron.
- The `design` hands-free state (`venus-design.tsx`).

## Callable-component gaps (the `pick` handshake)

The proven pattern exists (`ProductPicker.onAdd(CatalogBlank[])`). Each picker needs a `mode`/`title`/
`onResolve` prop and decoupling from its hard-wired side-effect. Priority:
1. **ProductPicker** — closest to done; add `max`/single-pick + resolver + internal `/api/blanks` fetch.
2. **Product grid (Sell tab)** — add `onSelectProduct`; unlocks "take the hoodie off my store".
3. **Brand picker (StudioDashboard)** — add `onSelect(slug,name)` + `mode`; unlocks "manage this brand".
4. Collection picker (design.tsx inline) — heaviest (extract + decouple side-effects); defer.
5–7. WebAssetsDock slot / ProductDetailSheet variant / BrandReview template — small wraps, opportunistic.

## 3D pose-morph — verdict

Build it as **damped uniforms on the existing `netGroup` + the `venus-orb-bus` shape morph
(`orb|tee|heart|bolt`)**. Do NOT move the camera (scene is built on a fixed head-on camera; halos +
silhouettes are billboards), do NOT rebake geometry (`bakeConnectome` is a one-time mount cost), do
NOT add react-spring (not installed; use the existing `THREE.MathUtils.damp` idiom). Free knobs:
`uExpand`, `uGrow`, `uJitAmp`, `uCrawlPos`/`uHotGang`/`uGangFlare`, `uColMix`/`uColA`/`uColB`,
`netGroup.rotation/scale`, `nucleus.scale`/`uFlare`. Pose tweens (uniform writes) are essentially
free. The scene is already near the phone GL ceiling (7 materials, heavy additive overdraw, full
`frameloop` with no demand-render) — **the one real risk to spike is compositing heavy 2D RN
surfaces over the live GLView on mid Android**; if it tanks, land `frameloop="demand"` + `invalidate()`
for headroom. Do not spike the pose tween — it's proven-idiom and cheap.

## Phase order

**Dependency spine:** registry → orb UI → pose glue → design state → selection handshakes → new
routes → money/stats. Cleanup interleaves.

- **Wedge (build now):** `eve-capabilities.ts` + a static energy-orb ring over the home guide,
  replacing the flat chips; voice + taps fire the same registry node. Plus Joe's layout asks:
  subtitles above Eve, no pause button (swipe up), orbs on the lower part. No new backend, no pose
  morph — off the GL-risk path. Deletes the dead chip code in the same commit.
- **C1 — Registry + orb tree hardened:** multi-level `branch` bloom + drag-through traversal;
  `pick`/`prompt`/`act` wired; Account sub-sections get `?section=` params.
- **C2 — Pose glue:** `poseRef` + `damp` in `useFrame`; per-node `pose` (shape/expand/grow/hotGang/
  colMix). Spike the overlay compositing first.
- **C3 — Design state:** `venus-design.tsx` + `POST /api/venus/design-turn`; land handshakes #1/#2.
- **D — Posts + scheduling:** `draft-post` + `scheduledAt` + cron; handshake #6.
- **E — Store/product lifecycle + stats:** build the missing unpublish/price routes + `sales-series`;
  402 interceptor through the overlay; handshake #4.

## Deprecation (as Eve absorbs these flows)

**Remove now:** the orphaned pre-Eve orb subtree in `studio.tsx` (`Nucleus`, `CoreLight`, `WaveBar`,
`OrbLayer`, `OrbLayerSvg`, `buildOrbLayer`/`OrbSpec`/`arcPath`, `IntroGlyph`, `NetworkField`,
`DustField`, `TONES`/`pick`, + their styles) — large, self-contained, VENUS_CENTRAL already flags it.
Dead styles in `design.tsx` and `studio-composer.tsx`. The chip surface in `eve-home` + `venus-guide`
suggestion machinery (fold into the wedge). The unread `design ?slot` param (decide with the registry).

**Do later:** the mechanical `venus→eve` identifier rename (one commit after C1 stabilizes; ~40 files;
user-facing strings are already Eve). **Do NOT remove:** `/feed` (v2), `SceneShortComposer` (paused),
the `?mode=interview` redirect shim.
