# EVE — AI-to-UI CONTROL (grounded build plan)

> Companion to `VENUS_CENTRAL.md`. This is the plan for the *greater vision*: Eve as the app's
> central, morphing control surface, grounded against a full codebase inventory (2026-07-05).
> Current state: **Eve lives on her own tab** — `/studio` hosts EveHome as the default surface (the
> pull-down overlay is retired, see "The overlay retirement"; brands are the BrandDeck, opened ONLY
> by the wheel's BRANDS spoke — the top-edge summon pill/pull-down was removed 2026-08-17),
> plus the `developing` site-edit state and the intent router (`/api/eve/route`). `design` is a
> translucent popup over EveHome (P3′ steps 1–3 + 6 shipped; 4–5 open — see the loop below).

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

## ~~The registry is the spine~~

**BUILT, THEN RETIRED.** `eve-capabilities.ts` + the energy-orb ring shipped 2026-07-05 (`795fb61`;
C1 `822bc54`, C2 `767815e`), then were deleted in the orb-front-end retirement (`83a6873`,
2026-07-06) — voice + the tabs are the two front-ends now (see the pivot's Shipped note). The
choice logic today lives in TWO places: the `/api/eve/route` intent enum + prompt and `eve-home`'s
`routeTurn` switch (`venus-guide.ts` is greeting-only). Kept below for the reasoning only.

The original read: the choice logic was **triplicated** — `venus-guide.ts` (chips), the
`/api/eve/route` intent enum + prompt, and `eve-home`'s `routeTurn` switch — and one hand-authored
`src/lib/eve-capabilities.ts` collapses them into a single source that BOTH the orbs and voice
dispatch read. Build it first — it de-duplicates before the rest multiplies.

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
- The `design` hands-free state — **SHIPPED** as `eve-design.tsx` (see P3′); spoken-turn iteration
  (C3b) still open.

## Callable-component gaps (the `pick` handshake)

The proven pattern exists (`ProductPicker.onAdd(CatalogBlank[])`). Each picker needs a `mode`/`title`/
`onResolve` prop and decoupling from its hard-wired side-effect. Priority:
1. **ProductPicker** — closest to done; add `max`/single-pick + resolver + internal `/api/blanks` fetch.
2. **Product grid (Sell tab)** — add `onSelectProduct`; unlocks "take the hoodie off my store".
3. **Brand picker (BrandDeck, `src/components/eve/brand-deck.tsx` — replaced StudioDashboard)** —
   already exposes `onEditBrand(slug,name)`/`onNewBrand`; a pick-mode resolver is what remains if a
   tree node needs it. Unlocks "manage this brand".
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

> **Wedge / C1 / C2 SUPERSEDED — built, then retired.** The registry + orb ring landed 2026-07-05
> (`795fb61`, `822bc54`, `767815e`) and were deleted with the orb front-end in `83a6873`
> (2026-07-06); voice + the tabs are the two front-ends now. Kept for the reasoning only.

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
- **C3 — Design state:** `eve-design.tsx` + `POST /api/venus/design-turn`; land handshakes #1/#2.
- **D — Posts + scheduling:** `draft-post` + `scheduledAt` + cron; handshake #6.
- **E — Store/product lifecycle + stats:** build the missing unpublish/price routes + `sales-series`;
  402 interceptor through the overlay; handshake #4.

## Deprecation (as Eve absorbs these flows)

**Remove now — DONE (`83a6873`):** the orphaned pre-Eve orb subtree in `studio.tsx` (`Nucleus`,
`CoreLight`, `WaveBar`, `OrbLayer`, `OrbLayerSvg`, `buildOrbLayer`/`OrbSpec`/`arcPath`, `IntroGlyph`,
`NetworkField`, `DustField`, `TONES`/`pick`, + their styles), the dead styles in `design.tsx` and
`studio-composer.tsx`, and the chip surface in `eve-home` + `venus-guide` suggestion machinery — all
deleted. **Still open:** the unread `design ?slot` param (`studio.tsx` still pushes `&slot=`;
`design.tsx`'s params never read it).

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

**Reused, not rebuilt:** the digest, the design + site-edit flows, the voice session — all re-home
from "overlay states" into "camera facets + overlays" on the one persistent Eve. (Two pieces this
list originally carried — the 3D capability orbs and the capability registry, `eve-capabilities.ts` —
existed when this was written and were SINCE DELETED in the orb-front-end retirement, `83a6873`.)

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
  (`_layout`, behind everything). `withScreenFade(..., { eveThrough: true })` swaps a tab page's
  opaque dot-field for a translucent scrim (`rgba(6,8,12,0.62)`) so she shows through, dimmed for text.
  Today: studio is `eveThrough: 'clear'`, design/account are `eveThrough: true`, and Market went back
  to an OPAQUE card page on purpose (Eve stays hidden + frozen behind it). Verified on web: one GL
  context, persists across tab navigation with no remount.

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

**~~Still ambient-only~~ — superseded by the overlay retirement below:** voice reactivity landed
(EveHome drives the root avatar through `eve-stage-bus`, `'silence' | 'talking'`). Still unbuilt:
the camera facets and per-page palettes (step 3).

### The overlay retirement (2026-07-06)

Joe on build 40: "get rid of the pull over effect — she needs to just have her own button on the
bottom bar." Steps 2/6/7 of the pivot landed together (step 5 — push-to-talk on the non-Eve
pages — remains open):

- **The pull-down overlay is GONE** (`eve-overlay.tsx`, `eve-background-bus.ts` deleted). The Eve
  tab (`studio.tsx`) hosts the voice machine: `EveSummon | null` state renders EveHome / EveDeveloping /
  EveDesign IN PLACE of the dashboard (a swap, not a layered overlay — nothing bleeds through, no
  backdrop needed). `summonEve()` works app-wide via `registerEveSummonListener` in the tab; the
  bus's queued-flush covers pre-mount summons (the composer's site tile). *Since superseded
  (`fa6c265`, `110c11a`):* EveHome is now the tab's DEFAULT (the dashboard became the swipe-down
  BrandDeck); only `developing` still swaps full-screen ("deep"); `design` renders as a translucent
  overlay OVER the still-mounted EveHome (see P3′).
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

---

# PHASE — WAKE AND WHEEL (2026-08-15)

Joe, reviewing a full UI audit of this tab: *"it defaults to her talking. as soon as you click on eve
she starts talking, even if the user didn't want to talk to her. This costs us money, as well as the
user, its poor design."* Plus: the top-edge pull-down is a fake gesture, the digest button is the
wrong control in the wrong place, and the subtitles sit too high.

**The direction (settled).** Two states only — **silent** and **talking**; a tap moves between them.
Press-and-hold opens a **radial wheel** of everything she can do, which replaces the BrandDeck's
pull-down entirely. A wake phrase ("Hey Eve") is explicitly OFF the critical path: Gemini Live cannot
provide one — anything the Live session hears is already a paid stream — so it needs an on-device
keyword spotter, a dependency the project does not have. Tap-to-talk instead.

Audit + defect list (D-01…D-24, each with file:line) and the mock/plan are the two artifacts linked
from Joe's review thread.

## P0 — SHIPPED 2026-08-15 (closes D-19 · D-20 · D-22)

The credit bleed, fixed. No redesign, no new files.

- **`talking` gates the session** (`eve-home.tsx`). It defaults to false and only a creator's tap
  sets it. Arriving on the tab now opens no socket, sends no greeting, and does not prompt for the
  microphone — `ensureMic()` runs on the first tap instead of on mount.
- **One `covered` signal** (`studio.tsx` → `EveHome`), raised by the deck, the Brand Console, the
  Paywall and the Welcome modal. Previously only the deck suppressed her, so tapping **edit** on a
  brand closed the deck, flipped `open` back to true, and started a *brand-new* session that
  immediately greeted the creator over the editor (D-20).
- **Suspend, don't stop** (`use-live-voice.ts`): `suspend()` mutes both directions and holds the
  socket for `SUSPEND_GRACE_MS` (45s) before releasing it; `resume()` returns false if the grace
  already expired so the caller can open a fresh one. Mute now has two independent owners (keyboard
  mode, suspend) OR-ed together — writing `setMuted` directly from both meant whichever fired last
  won, and resuming un-muted a keyboard-mode session.
- **`greetOnOpen`** (`live-voice.ts`): the setup-complete greeting nudge is skipped when a socket is
  re-opened under an ongoing conversation, so she picks up rather than re-introducing herself.
- **The state pill** (top-right, at `insets.top` — see the Safe areas rule in `UI_RULES.md`) is her
  state, always on screen and tappable: SILENT · CONNECTING · LISTENING · THINKING · SPEAKING ·
  PAUSED. At rest a 30% scrim dims her; it lifts when she talks.
- **Verified in a foregrounded browser with full network capture:** arrival → pill SILENT, zero
  `/api/voice-live-token`, zero Gemini sockets. Tap → one token, one socket, one greeting, pill
  LISTENING. Opening the deck and then the Brand Console → **no** new token, socket or greeting, and
  the transcript survives. (The mute-while-covered itself is code-verified, not observed — there is
  no external signal for it.)

### Follow-ups from Joe's device pass (2026-08-16)

- **Tint** — the brand-review screen is a form over a moving avatar and was unreadable. EveHome's
  scrim now tracks how much reading the surface demands: none while talking, `0.30` at rest, `0.82`
  behind brand review and the interview topic list. Same fix covers the post-create "store online"
  state, which is the same screen. Also drops `talking` when the `BrandResult` lands — the socket was
  already closed by `finalize()`, but the intent flag stayed set and the pill claimed she was
  listening while the creator read a form.
- **Launch voice** — the fanfare moved off `/api/say` onto an announcement-mode Live session
  (`announce()` / `speakOnly`). Full rationale in [GEMINI_LIVE.md](GEMINI_LIVE.md) → "Launch
  announcement". Needs a **device** check: web has no audio playback path.
- **Collaborators**: `store_collaborators` + `tenant.ts` already grant access; only the invite/accept
  flow and its UI are missing. (`GET /api/creator/stores/:slug` was matching `creatorId` directly and
  404ing collaborators — fixed, and `DELETE` is now explicitly owner-only.)

### PAYOUTS — LIVE 2026-08-16

Connect is **enabled** on the Nano Crew platform account (`acct_1ThhvX5lsCYjUGb3`, charges enabled,
`transfers` + `card_payments` active) and `STRIPE_CONNECT_ENABLED=1` is set. `connectEnabled()` is
true, so **the go-live gate is real**: a store can only go live once its creator is `charges_enabled`.

The code was already complete (`src/lib/connect.ts` — Express accounts, destination charges with the
platform application fee, payouts held until ship date + return window then transferred, refunds with
transfer reversal; `/api/creator/connect`; `/api/internal/release-payouts`; UI in Account). Turning it
on exposed one latent bug, now fixed:

- **Where the Stripe landing pages live.** `createOnboardingLink` returns creators to
  `{BILLING_RETURN_URL | PLATFORM_API_BASE}/connect/return` → `nanocrew-api.vercel.app`, but the only
  `connect/return` pages were in **nanocrew-site**. A creator finishing identity verification hit a
  404. **The rule, going forward: every Stripe-facing landing page lives in `platform-api`, next to
  `billing/success`.** That keeps the money surfaces off the app bundle — isolated from Apple's rules
  — and gives one web host serving iOS, Android and web identically. `connect/return` +
  `connect/refresh` are now platform-api pages with a `nanocrew://` deep link home. The
  nanocrew-site copies are superseded and should be deleted or redirected.
- **Status refresh on return.** Account read payout status once per session, so a creator came back
  from a completed onboarding and still saw "Finish payout setup". It now re-reads on the deep-link
  param and on foregrounding (most people swipe back rather than tapping the button).

**Open:** surface payout state on the **Brand sheet** (below) rather than only in Account — a creator
should see "payouts active" / "finish setup" on the brand that earns the money. Also unverified end
to end: no creator has completed real Connect onboarding yet, so the return round-trip is
code-verified only.

### Revised plan (2026-08-16)

| | | Status |
|---|---|---|
| **P0** | Silent by default · covered-suspends · tap-to-talk | **shipped** |
| **P0.1** | Reading tints · launch voice through the Live model | **shipped** |
| **P0.2** | Payouts live: Connect enabled, return pages on platform-api, status refresh | **shipped** |
| **P1** | Caption block + status band + the D-08 toast overlap | open |
| **P2** | The wheel (`eve-wheel.tsx`) | open |
| **P3** | **Brand sheet** — replaces the deck AND the un-revisitable post-build success screen: identity (logo · palette · story · vibe, already served by `GET /api/creator/stores/:slug`), earnings + orders + views, unfinished tasks, **payout status**, site link | open — next |
| **P3.1** | Edit identity in place — **must** go through `buildBrandPatch()` (NEVER_VIOLATE §2) | open |
| **P4** | The D-01…D-18 batch | **shipped 2026-08-16** (OTA `ec614fd6`) — D-01/02/07/08/14/15/16/17/18; D-03/04/23 landed with P0/P1 work; D-05/06/09–12 close with the wheel + brand sheet (P2/P3) |
| **P4.1** | **Collaborator invite** — endpoints shipped 2026-08-16 (`/api/creator/stores/:slug/collaborators`, owner-only manage; membership admin stays owner-only, go-live/publish/domain unchanged). **UI still open** — needs a surface in the Console or Brand sheet. | endpoints shipped · UI open |
| **P5** | Optional wake phrase (needs an on-device keyword spotter) | deferred |

---

# PHASE — EVE AS A CONVERSATIONALIST (build plan, 2026-08)

Joe: *"I want her far more conversational. Right now she really knows one purpose — help create the
brand. I'd also like store digests on how things are doing, talk over ideas, and have her create
designs, show them, and apply them to products of our choice. For that she needs the full product
catalogue and the ability to send and receive designs to Gemini."*

**Audited against the code on 2026-08-01, not against this doc** (the doc was stale). Most of the
machinery already exists — this phase is four ADDITIVE changes, no new tables, no rebuilds.

## What already exists (verified in code — reuse, do not rebuild)

| Piece | Where | State |
|---|---|---|
| Intent router | `src/app/api/eve/route+api.ts` | live; intents `create-brand · edit-site · new-design · write-post · digest · done` |
| Digest | `src/lib/eve-digest.ts` + `/api/creator/stats` | **works end-to-end** — renders + she narrates the headline |
| Design in her own surface | `src/components/eve/eve-design.tsx` | generate `/api/generate`, show large, iterate `/api/edit` |
| Context injection | `live.sendContext()` (`live-voice.ts`) | the primitive for feeding her facts mid-turn |
| Catalogue | `/api/blanks`, `/api/blank/[id]/variants` | live |
| Design → product render | `/api/composite` | live |
| Per-creator access | `src/lib/tenant.ts` | use for every new read |

**Hard architectural constraint (still true):** native-audio Gemini Live **cannot do reliable
tool-calling** — that is why the router exists. New capabilities go through **the router +
`sendContext`**, never function declarations. (`SAVE_BRAND` is the one exception and stays gated.)

## The four gaps

1. ~~**She is an interviewer, not a conversationalist.**~~ **CLOSED 2026-08-17.** Rewritten around
   Sinek's golden circle: she probes for the why instead of asking for it, and every question must be
   answerable by naming a thing. See [`EVE_VOICE.md`](EVE_VOICE.md).
2. **The digest is conversationally dead.** It renders and she reads a headline, but **no numbers enter
   her context** — she cannot answer "how was last week?" or compare brands.
3. **She cannot see what she made.** Only `audio` is sent to the session. SDK `@google/genai` 2.8.0's
   `sendRealtimeInput` accepts `media`/`video`, so vision is available and unused.
4. **No product awareness.** No catalogue in her context and no path from a design to "put it on a hoodie".

## Phases

### P1 — Conversational core (prompt only) — ✅ SHIPPED 2026-08-01
Rebalance `eveCentralInstruction` (`src/lib/live-voice.ts`): conversation and ideation first, brand
interview demoted to a module she *enters*. Tell her plainly what she can do, including the digest
(today her prompt never mentions it).
- **⚠ Fragile coupling:** the interview module must keep the literal *"ready to build your brand"*
  phrasing — `eve-home.tsx`'s `buildReady` regex listens for it. Change the wording and the Build
  button silently never unlocks. Carry that sentence verbatim.
- **Shipped:** `eveCentralInstruction` reordered — a new HOW YOU TALK section makes conversation the
  job ("a conversation that produces no task is a fine conversation"), the old
  "always nudging toward making something" steer is gone, the brand interview is a module she ENTERS,
  and she is finally told the **digest** exists (with an explicit "don't invent numbers" guard).
- **Verified:** the buildReady cue still matches, the DELIVERY voice paragraph is untouched, tsc clean.
  Conversational QUALITY is unverifiable from code — it needs a real spoken session.

### P2 — A digest she can actually discuss — ✅ briefing SHIPPED 2026-08-01 (sales-series still open)
Feed the real numbers into her context instead of a "say the headline" nudge: extend the `digest`
case in `eve-home.tsx` to `sendContext` the tiles/values so follow-up questions work.
- Then add **`GET /api/creator/sales-series`** for trends — *already named as a needed route in the
  capability tree above*, so this is on-plan, not new scope. Units live in `order_items.quantity`.
- **Shipped:** `digestBriefing()` (`src/lib/eve-digest.ts`) turns the same rows into a spoken briefing —
  totals + per-brand figures + an explicit LIMITS clause so she declines what she can't know instead of
  estimating revenue. `openDigest()` now RESOLVES with the rows; both the voice intent and the
  "View your digest" button brief her identically. Verified by running the pure function.
- **Still open:** `GET /api/creator/sales-series` for trends ("how was last week?"). `/api/creator/stats`
  is already IDOR-safe via `accessibleStoreIds` — the new route must do the same.
- **Rules:** per-creator reads via `tenant.ts` (§1 IDOR class). Authed route ⇒ **DB query before any
  outbound `fetch()`** (§1, the persistent-Node/postgres-js constraint).

### ~~P3 — She sees the design~~ · ### ~~P4 — Designs onto products~~

**SUPERSEDED 2026-08-01 by P3′ below** (Joe redirected the design). Kept for the reasoning only.

#### (old) P3 — She sees the design
Send the generated image into the live session (`sendRealtimeInput({ media: … })`) from
`eve-design.tsx`, so she reacts to what is actually on screen instead of narrating blind.
- Gate to the design surface; send once per settled design (not per frame) — this is a live audio
  session and images are not free.
- Unknown to measure first: latency/token cost of an image mid-session. Prototype before committing.

#### (old) P4 — Designs onto products
Add an **`apply-to-product`** intent to the router → resolve a blank → `/api/composite` → show it.
- Reuse the **`pick` handshake** already prioritised above: `ProductPicker` is listed as "closest to
  done" — add `mode`/`onResolve` rather than writing a new picker.
- Give her catalogue awareness via `sendContext` (categories + the creator's own products), not by
  stuffing the whole catalogue into her system prompt.

## Compliance audit (`docs/context/NEVER_VIOLATE.md`)

| Rule | Impact |
|---|---|
| 🔴 Schema duplicated — sync both halves | **N/A** — no new tables |
| 🔴 New migration ⇒ RLS | **N/A** — no migration |
| 🟡 Per-creator data via `tenant.ts` | **Applies** — P2 stats + P4 products |
| 🟡 No `fetch()` before first DB query | **Applies** — P2/P4 routes must query first |
| 🔴 Pre-push gate: `tsc` + `expo export` + lint | Applies to every phase |
| 🟡 Don't remove the Metro `@google/genai` web-build override | **Applies** — P3 touches the Live session |
| 🟡 Copy is data | N/A — no site copy |
| 🟡 Reuse before you build | Satisfied — every phase extends existing machinery |

## Sequence
P1 → P2 → P3 → P4. P1+P2 change how she *feels* immediately and carry the least risk; P3 is the
unknown (measure first); P4 is the largest surface and depends on the picker handshake.


---

## P3′ — THE VOICE DESIGN LOOP (supersedes old P3 + P4)

Joe: *"we don't want the design screen to open — she should present it in an almost transparent modal
on the Eve screen, then the user could describe the product they want to put the design on, and she
can give options, and do it herself… similar to the design flow, but just done through voice."*

**Why this is better than the old plan.** Old P3 assumed we'd send an image into her live session on
the design surface — but at the time **she had no session there**: `studio.tsx` rendered `EveDesign`
and `EveHome` in a ternary, so entering `state:'design'` unmounted EveHome and stopped the mic.
`110c11a` dissolved that: `design` is no longer a `deep` state — `onGo({state:'design'})` now renders
the popup OVER a still-mounted EveHome, so **she never leaves her screen and the session never tears
down.** No session-lifting needed.

### The loop
1. "make me a stay gold graphic" → `new-design` intent → `onGo({state:'design'})` opens the
   TRANSLUCENT popup over EveHome (**shipped**, `110c11a` — `design` is excluded from `deep`, so her
   session survives).
2. **SUPERSEDED by the full pipeline (2026-08-17, Joe's california-flag walkthrough):** EveDesign
   is now product-first and finishes IN her tab — routed idea → `ProductPicker` (reused, modal) →
   she asks enhance-or-as-is (say-bus) → `POST /api/generate` (`background:'transparent'`, a
   she LEADS the handoff (one line: idea back + "opening the product selection" + ONE suggestion) and the picker mounts when that line DISPATCHES, not before (2026-08-18) → print-ready cutout) → approve → `POST /api/compositions` → `PlacementEditor` (reused) →
   `FinalizeSheet` (reused; prices + `POST /api/publish`, which auto-generates on-model shots) →
   live in the catalogue + site. NO redirects — the old "Open in Design ›"/meme `router.push`
   handoffs are gone. The router's `idea` is the ARTWORK concept, never the garment.
3. She SEES it — `eve-vision-bus` (`showEve` in EveDesign → `imageForEve` → `live.sendImage` in
   EveHome) fires on every settled generation/edit, and she reacts to the actual image (**shipped**).
4. "put it on a hoodie" → she offers options from `GET /api/blanks` (**open** — endpoint exists,
   cached server-side; the voice loop that drives it is unbuilt).
5. She applies it — `POST /api/composite` ("Nano Banana renders the design ON the garment photo",
   review-only, returns a Cloudinary URL). Mockup replaces the design in the same modal (**open**).
6. **Hand off to finalize** (**shipped**) — the popup's designs already exist server-side with ids,
   so the hand-off is `sendDesignCommand({ kind: 'open-editor' | 'show-design', designId })` + route
   to `/design` (not `ingest-design`, which is for external URLs). The bus queues while that screen
   is unmounted and flushes on mount.

### Scope boundary (Joe's call)
Voice does the CREATIVE work; the Design center does the COMMITTING. Nothing is published to the
store by voice — no Printful, no pricing, no listing. Worst case of a mishearing is a throwaway mockup.

### Everything reused
`/api/generate` · `/api/blanks` · `/api/composite` · the design bus · `live.sendImage` · the Modal
pattern already in eve-home. New code = the in-place modal + the voice loop that drives it.


## The wheel — shipped 2026-08-16

Press-and-hold anywhere on Eve opens the radial menu (`src/components/eve/eve-wheel.tsx`); drag to a
sector, release to choose; release in the centre dead zone to cancel. A quick tap still just toggles
her — the two are raced via `Gesture.Exclusive(pan.activateAfterLongPress(180), tap)` so they can
never both fire.

Eight sectors, cardinals + diagonals: **Talk to Eve** (12 o'clock, amber — the only one that spends
money), New design, Edit site, Site assets, Digest, Brand info, New brand, Type instead.

- `spokeAt()` is exported and shared by the gesture and the render — one hit-test definition.
- Brand-scoped sectors (site, assets, digest, brand) dim until the creator has a brand, and a dimmed
  sector does nothing rather than misfiring.
- **Brand info** has no in-place editor yet (P3.1 below is still open), so it asks Eve rather than
  stubbing one; edits still go through `buildBrandPatch()`.
- Still to prove on device: the tap/long-press race, per the mock's own note.

## The wheel's spokes — what each one owns (2026-08-17, EDIT added 2026-08-19)

**Nine** sectors, evenly spaced at 40° (was eight at 45° — EDIT was added 2026-08-19 so the live-site
editor is reachable without asking her). TALK keeps 12 o'clock and the clockwise ORDER is unchanged;
only the spacing moved. `spokeAt()` in `eve-wheel.tsx` is exported so the gesture and the render
share one hit test.

| Sector | Does | Notes |
|---|---|---|
| **TALK** (12 o'clock, amber) | `toggleTalk()` | the ONLY spoke that spends money — set apart in amber for that reason |
| **DESIGN** | voice-ask via `sendContext` | she stays home and ASKS what to make (starts talking if silent); the answer routes back as `new-design{idea}` → `<EveDesign>` opens already generating. Never opens the typed form — a routed `new-design` with no idea also re-asks instead of opening empty (2026-08-17; was `onGo({state:'design'})`, which landed in a bare text input) |
| **BRANDS** (label; id `site`) | `onShowBrands()` | summons the **Your-Brands deck**, which IS the console now (merged 2026-08-17): its pills (Edit site · Posts · Settings) render `StudioComposer` **embedded, inline** under the card — the standalone console Modal is gone, and the Sell/video-ads tab was deleted (rebuilt later). Voice edits stay reachable by asking her (`edit-site` intent → `EveDeveloping`). (2026-08-17; was `onGo({state:'developing'})`, which stranded the console once the wheel replaced the deck as the main path) |
| **EDIT** (id `edit`) | `openSiteEditor({ canAsk: talking })` | straight into the live-site editor (`EveDeveloping`) — the SAME door the `edit-site` intent uses, so the brand choice can't drift between them. One live site opens immediately; several and she **asks which brand** by voice; if she isn't listening they get the brands deck to tap instead; none and she says so. | brand-scoped |

**Answering "which brand?"** is a one-shot, like `awaitingDesignIdea`/`awaitingAssetIdea`: the ask
latches `awaitSiteChoice`, and the router is told `awaitingSiteChoice: true`, so a bare name
("Sardine Club", even mis-heard as "Sardene Club") classifies as `edit-site` with that slug
instead of dropping to `none`. The context line also tells her what the answer DOES — without that
she treated the reply as a new topic and started pitching hero artwork (2026-08-19).
| **ASSETS** | Voice-first, like DESIGN (2026-08-18): she asks what to make and for which spot (hero / logo / social) → the answer routes as `site-asset{idea,slot}` → **EveAssets** (`eve-assets.tsx`, Eve state `assets`): enhance-or-as-is → generate with slot framing (hero/og 16:9 filled, logo transparent) → same review tools → "Set as …" → `/api/creator/site-assets` (direct write + revalidate). No Design-tab redirect. | brand-scoped |
| **DIGEST** | `openDigest()` | brand-scoped; also briefs her with the real figures |
| **BRAND** | asks Eve conversationally | no in-place editor yet (P3.1); edits still go through `buildBrandPatch()` |
| **NEW** | `startVoice()` with a REINTRODUCTION greeting (she's Eve, idea → finished brand, then "what's the business all about?") | NOT `enterInterview()` — startVoice carries the mic request + typing fallback. The interview surface is voice-PURE (2026-08-18): no topics checklist / pause / ‹ tools / build pill — captions only; "okay, build it" spoken after her ready-cue triggers the build. |
| **TYPE** | `setKeyboardMode(true)` | the path when the mic is denied |

Brand-scoped sectors dim **only when we know** there are no brands: `storesKnown && !stores.length`.
`stores.length === 0` alone conflated "no brands", "not loaded yet" and "the request failed" — a
creator with six brands saw four dead spokes. A failed `/api/me` now retries once and fails **lit**.

`hidden` on `<EveHome>` is **pixels only**. Her own full-screen states sit on top of home, so its
chrome must not print through — but the live session and the vision listener live in EveHome and the
overlay publishes to them (`lib/eve-vision-bus`). Suspending her there would mute her for the whole
design flow and stop her ever seeing what she made. `covered` remains for surfaces she must not
narrate; her own states are not among them.

Both CTAs under her ("Build your brand", "View your digest") are gone — they're spokes now.
