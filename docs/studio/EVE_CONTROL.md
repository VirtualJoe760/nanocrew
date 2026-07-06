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

---

## THE PIVOT — Eve IS the app (2026-07-05)

Joe: "instead of her being a pull down, she just is the background." The pull-down overlay is
**superseded**. Eve is now the persistent living background of the whole app; you navigate and the
CAMERA moves to a new facet of her while that page's components overlay on top.

**Architecture:**
- **One persistent Eve scene** at the app root (venus-orb-scene), always mounted, behind every page.
  The old page backgrounds (dot-fields on Studio/Market/Account) are scrapped — Eve is the background.
- **Bottom bar: Eve · Design · Market · Account.** Market STAYS (Joe: "add market keep market there").
  The **Studio page merges into the Eve page** (dashboard, brand management, interview, digest, orbs).
- **Navigation = an INFINITE-ZOOM camera flight.** Joe: "like those infinite drawings — it zooms into
  part of the net and finds a different angle of another orb that is still Eve, from different lighting,
  maybe different colors." Each page is a FACET: a camera dolly-zoom into a target region of the net +
  a palette/lighting morph, arriving relit/recolored but unmistakably still her. You never leave her —
  you go deeper.
- **Push-to-talk, top-right** on non-Eve pages (Design/Market/Account) — hold to talk to her since
  she's present but not the focus there. On the Eve page she's the focus (open-mic / the orbs).
- **Idle throttle** — she calms + slows (frameloop demand / lower rate) when you're heads-down in a
  page so the always-on scene stays kind to the battery.

**Reused, not rebuilt:** the 3D capability orbs (already in her scene), the capability registry, the
digest, the design + site-edit flows, the voice session — all re-home from "overlay states" into
"camera facets + overlays" on the one persistent Eve.

**Technical reads:**
- A ZOOM (dolly along the view axis) is the SAFEST camera move — the scene's billboards (halos, the
  tee/heart/bolt silhouettes) face +z and STAY facing the camera as you dolly straight in. So the
  infinite-zoom is the friendliest of the "dramatic" moves; a gentle pan/tilt toward the target facet
  plus the net's own spin gives the "different angle."
- Recolor/relight per facet is nearly FREE — the scene already has full palette machinery (uColMix,
  uColA/B, the 80bpm color clock, NET/LIM/NUC palettes). Each facet just shifts the palette.
- The one STRETCH: truly-infinite / seamless-Droste-loop zoom (zoom forever, endless new Eve) needs
  self-similar geometry or a reset trick. Not needed for the feel — a deep zoom-into-a-facet that
  arrives recolored + relit sells "infinite drawing" without the infinite math. Push toward looping later.

**Revised sequence:** (1) Eve → app root as persistent background + scrap page bgs; (2) the 4-tab bar
+ merge Studio into the Eve page; (3) the camera-facet system (a facet bus: RN sets the target
facet → the scene dolly-zooms + palette-morphs); (4) per-page overlaid components; (5) push-to-talk;
(6) idle throttle; (7) retire the pull-down overlay. Camera-facet spike FIRST (de-risks the flight).

### Shipped

- **4-tab bar** (step 2, partial): `app-tabs` is Eve · Design · Market · Account; the center summon
  button and the capability orbs are gone (the orb-tree front-end is dropped — voice + the tabs are
  the two front-ends now). The `/studio` route IS the Eve tab (header reads EVE).
- **Persistent Eve background** (step 1): `eve-background.tsx` mounts the ONE avatar at the app root
  (`_layout`, behind everything). `withScreenFade(..., { eveThrough: true })` swaps each tab page's
  opaque dot-field for a translucent scrim (`rgba(6,8,12,0.62)`) so she shows through, dimmed for text.
  studio/design/market/account are all `eveThrough`. Verified on web: one GL context, persists across
  tab navigation with no remount, visible behind the gate / Market / Account.

  Two things future-me will trip on:
  - **One-context invariant preserved via a gate, not a merge.** The pull-down overlay (`eve-overlay`)
    still mounts its OWN avatar for the home/interview, and it slides OVER the tabs (so it can't reveal
    the root Eve behind them). Rather than solve that now, the root avatar YIELDS while the overlay is
    up: `eve-background-bus` carries one bool (`covered`); the overlay sets it from `mounted`; the root
    unmounts its avatar when covered. Gated on `mounted` (pre-slide), NOT `ready` (post-slide), so the
    root avatar is gone BEFORE EveHome mounts its own — the two never coexist (no 2-context frame).
    Step 7 (retire the overlay) deletes this gate; step 2's real Studio→Eve merge moves the home
    content onto the Eve tab where it sits over the root Eve with no overlay conflict.
  - **R3F Canvas at the app root needs an explicit size + a deferred mount.** `<Canvas style=flex:1>`
    measures its container ONCE on mount; at the root it mounts before layout settles, measures 0, and
    sticks at the 300×150 default forever. Fix in `eve-background`: explicit `useWindowDimensions()`
    width/height on the wrapper + defer the avatar one `requestAnimationFrame` (`ready`) so it mounts
    into a settled full-screen container. The overlay never hit this because it mounts its avatar after
    the 340ms slide, when layout is already done.

**Still ambient-only:** the root Eve sits at a fixed `stage="silence"` — she doesn't yet react to
voice or drive per-page palettes. Wiring her lifecycle/voice + the camera facets is next (step 3).

### The overlay retirement (2026-07-06)

Joe on build 40: "get rid of the pull over effect — she needs to just have her own button on the
bottom bar." Steps 2/5/6/7 of the pivot landed together:

- **The pull-down overlay is GONE** (`eve-overlay.tsx`, `eve-background-bus.ts` deleted). The Eve
  tab (`studio.tsx`) hosts the voice machine: `EveSummon | null` state renders EveHome / EveDeveloping /
  EveDesign IN PLACE of the dashboard (a swap, not a layered overlay — nothing bleeds through, no
  backdrop needed). `summonEve()` works app-wide via `registerEveSummonListener` in the tab; the
  bus's queued-flush covers pre-mount summons (the composer's site tile).
- **One GL context, no gate.** EveHome no longer mounts an avatar — it drives the ROOT one through
  `eve-stage-bus` ('silence' | 'talking' ONLY; 'morphing' is destructive on a formed background —
  it ping-pongs the reveal). Syllable-level reactivity rides the module-level speech envelope.
- **Scrim control:** `withScreenFade(..., { eveThrough: 'clear' })` = transparent bed, NO wrapper
  scrim; the Eve tab renders its own EVE_SCRIM and DROPS it while a voice surface is up (she
  performs at full brightness).
- **Low power off the Eve tab:** `EveBackground` reads `usePathname()`; non-/studio routes pass
  `lowPower` → the Canvas `frameloop` prop flips to 'demand' + a coarse invalidate ticker in Orb
  (~6fps ambient, 30fps while speech is audible). MUST stay a Canvas prop — the native Canvas's
  dep-less configure() resyncs frameloop from props on every re-render. DPR is NOT a lever on
  native (expo-gl fixed buffer).
- **Bar proportions fixed:** paddingBottom `insets.bottom + 16` → `max(insets.bottom, 8)` (the old
  value left a ~50pt dead lip), icon 26→24, paddingTop 12→6 — native UITabBar metrics.

**NATIVE GL — the big unresolved:** on the iOS **simulator** the scene presents NOTHING (proved
with a raw no-three expo-gl probe: even a manual clear+endFrameEXP loop doesn't paint from the rAF
loop; a one-shot present from onContextCreate DOES). This matches the documented "simulators don't
work with three+EXGL" ecosystem stance — the simulator is NOT a valid GL verification target;
verify on device. Two device-side hardenings landed anyway: a priority-1 useFrame render takeover
with a fingerprint check (guards R3F v9's native gl.render patch being lost to configure() churn —
single present in every world, no double), and `@react-three/drei` uninstalled (unused; its
stats-gl dep bundled a second three copy — the "Multiple instances of Three.js" warning). Whether
build 40's background was black on Joe's PHONE is unconfirmed — check TestFlight 41 first thing.
