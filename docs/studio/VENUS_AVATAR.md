# Venus — the talking 3D avatar (live build)

> **Status: POC, in progress.** Branch `feature/welcome-onboarding`. Verified on the web
> preview only (not yet on a native dev build). This doc is the source of truth for the
> Venus-avatar work — read it before continuing.

## The vision
Venus is the AI a creator talks to in **Studio**. Today she's a monochrome orb/nucleus.
We're turning her into a **glowing wireframe / "plexus mesh" face** that:
1. **materializes out of the app's dot-field background** (the same dots swarm together to
   form her face, then disperse),
2. **lip-syncs to her Gemini voice**, and
3. **looks alive** (blinks, eye darts, brow flicks, a slow head sway, a faint smile).

Two visual references the user gave (see this session's transcript):
- **Look** = a glowing white **wireframe/particle head** on dark (the "plexus" aesthetic).
- **Character** = an ethereal **silver-haired, blue-eyed woman** ("Venus"). We generated a
  clean portrait of her (Higgsfield `soul_2`); kept as the character north-star. As a
  *wireframe* the exact likeness is abstracted away — topology + glow is what reads.

## How we got here (decisions — don't re-litigate)
1. **Skia photo point-cloud** (sample the Venus portrait into dots) → **rejected**: a soft
   portrait carries no structure, so the cloud only vaguely read as a face.
2. **Skia canonical face-mesh wireframe** (MediaPipe `canonical_face_model.obj`, 468 verts +
   1365 edges, rendered as glowing wireframe + dense surface dots that morph in) → looked
   good and **proved the dots-morph-into-a-face idea**, but it's flat 2.5D, a generic neutral
   mesh, and lip-sync would be hand-rolled per mouth vertex. Commits `1d68065`, `eeaa481`
   (superseded; code still in `venus-field-scene.tsx`, see below).
3. **R3F + Ready Player Me head (CURRENT)** → the pivot. The user wants **spot-on lip-sync**.
   The only hard/slow part of a talking face is the **viseme rig** (mouth shape-keys). RPM
   avatars ship the **full ARKit 52 blendshapes + 15 Oculus visemes for free**, so we get the
   rig for nothing, render the head as **our wireframe** (skin/likeness abstracted), and
   lip-sync becomes "feed weights." This is the same toolkit VTubers / NVIDIA Audio2Face use.

**Why not the alternatives:** streaming avatars (HeyGen/Simli) = photoreal but per-minute
cost + their video, not our mesh, and the user chose "own it." `generate_3d` from the
portrait = a head but **no visemes**. Blender authoring = slowest, and Blender is on the
user's *other* (Windows) machine — unusable from here.

## Aesthetic direction — "Ascendant Cortana"
User's north star: **"cyberpunk, Cortana, super-intelligence."** Translated (via an art-direction
workflow) into a concrete, expo-gl-safe spec — the **`venus-art-direction` workflow synthesis**:
- **Palette** — one hue family, **cyan→periwinkle→violet** (185°→280°), never warm/gold (brand
  rule). Positional aurora: front/low = cyan `#5BD8E6`, cheek/mouth band = periwinkle `#7C9BF0`,
  high/grazing = violet `#B97CF2`, crown = teal-white `#CFF6FF`. Navy-black bg `#06080f`.
- **Signature = the travelling THOUGHT-PULSE** — waves of brightness sweep up the wireframe
  (jaw→crown) like neural activation, so you *see her think*. Height-driven in the node vertex
  shader (one `uTime` uniform; zero per-frame CPU). Idle period ~3.5 s; cascades faster while she
  speaks. **This is the "super-intelligence" tell.**
- **Restraint rules** (what keeps it premium, NOT gaudy): hue clamped to the cyan→violet arc
  (±14°, ≥28 s); exactly ONE instability (a rare ~×0.82 "holographic blip"); **no** scanlines,
  glyphs, chromatic-split, or HUD; the **mouth/eyes stay the highest-contrast thing every frame**
  (lip-sync must always read). Everything ambient is slow (5–28 s) and shallow.
- Full spec: the `venus-art-direction` workflow output (saved this session). Dropped from the
  concept panel by design: A's scanlines + falling glyphs, B's chromatic aberration + glitch + HUD.

## Current state (built + verified on web)
- 3D stack: `three` ^0.184, `@react-three/fiber` ^9 (R3F v9, React 19), `@react-three/drei` ^10,
  `expo-gl` ~16. Web renders via plain WebGL; native uses expo-gl — **native not yet verified**.
- **`src/components/backgrounds/venus-head-scene.tsx`** (the live POC, rendered by the Lab) — now
  the full **"Ascendant Cortana"** build:
  - Loads the **female** RPM head via plain three `GLTFLoader` (NOT drei `useGLTF` — see gotchas).
  - **Clean-face fix (the hair/face conflict):** only the 4 morph-rigged meshes are the face
    (`Wolf3D_Head`, `EyeLeft`, `EyeRight`, `Wolf3D_Teeth`); body/outfit/**glasses** are hidden. The
    substrate is `side: FrontSide` (culls the back-of-skull x-ray → reads as a face).
  - **Hair — a PROCEDURAL BOB** (`buildBobHair`): the demo avatar only ships **long** hair, and
    clipping that mesh can't fake a bob's *shape*. So the long `Wolf3D_Hair` is **hidden** and we build
    the bob ourselves — a **revolved BELL profile** (`prof(t)`: rounded crown that hugs the skull →
    full width over the ears → taper IN toward the jaw; a sphere reads as an afro, a bell reads as a
    bob), sized off the **crown + eye line** ("eyes are halfway down the head"). Built as an **INDEXED**
    grid (shared verts + welded seam → `computeVertexNormals` gives SMOOTH shading, the #1 anti-facet
    fix) with triangles carved for the **face opening**, an **A-line bottom** (tilted cutoff, front
    longer), and a **blunt fringe** (snapped to a grid row for a straight edge). Per-vertex attributes
    baked: `aRoot` (crown→tip), `aAround` (azimuth), `aEdge`/`aEdgeF` (soft hem / fringe edge),
    `aFlow` (object-space strand flow).
  - **Hair SHADER** (`HAIR_VERT`/`HAIR_FRAG`, realism pass): a **Kajiya-Kay / Scheuermann dual
    anisotropic sheen** (the bright highlight band that reads as hair — tangent = the baked flow
    projected onto the surface, lit by a faked view-space upper-front light fed per-frame via
    `uViewRot`/`uTime`), over a **root→tip teal gradient**, **procedural strand striations**, a soft
    **fresnel rim**, a **feathered A-line hem** + crisp fringe edge. `NormalBlending`, `uBaseAlpha`
    ~0.88 (solid hair occludes the face behind the fringe). ES2/expo-gl-safe (no postprocessing,
    no loops/dFdx; promote `mediump`→`highp` if the crown band crawls on device). ~20 tunable uniforms;
    the 5 worth eyeballing: `uBaseAlpha`, `uShift1/2`, `uStrandCount`, `uExp1/2`, `uTipFade`.
  - The bright **ear geometry is dropped from the face shell** (`dropEars`, `EAR_DROP_FRAC`) so it
    doesn't poke through the bob. **Note:** the procedural bob is the demo workaround — the user's own
    RPM Venus with a real bob asset (URL swap) is the production answer; RPM was unreachable when built.
  - **Eyes — a readable IRIS:** a sprite with a generated iris texture (dark pupil + bright limbal
    ring + striations + catchlight, `makeIrisTexture`) over a faint halo, parented to the
    `LeftEye`/`RightEye` bones so the gaze **tracks the saccades**. (Additive: the alpha-0 pupil reads
    dark, so the iris is visible.) Sized (`irisMat.size`) to read at the **portrait camera crop**
    (camera pulled in to ~0.99 on the eyes — see the framing block).
  - **Two-layer render:** a DIM constant-color morph-driven substrate (`MeshBasicMaterial`
    wireframe, opacity 0.12, all 4 face meshes) carries lip-sync + blink, UNDER a **bright static
    glow shell** parented to the `Head` bone (built once via `bakeHeadLocal` → head-local geometry →
    `mergeVertices`): aurora-gradient **nodes** (a `ShaderMaterial` carrying the thought-pulse) +
    node halo + `EdgesGeometry` lines + a fresnel **core-glow** sphere; plus a billboarded
    **aura pool**. All additive (no postprocessing); GLSL is ES2/expo-gl-safe.
  - **"Refined" pass** (user direction — *cleaner, structure-led*): the glow shell is built from the
    face SKIN only (`SHELL_NAMES = ['Wolf3D_Head']`) so the eyeballs + teeth stay on the dim
    substrate (clean sockets, no bright eye-blobs); **edges lead** (opacity 0.36) over a sparser
    (`subsample` stride 3), smaller node field; tighter halo (0.12), subtler pulse crest, dimmer
    core/aura/hair. The tuning lives in a few constants — easy to push back toward "vivid."
  - **Real lip-sync** (`src/lib/venus-lipsync.ts`): a zero-dep Web-Audio `AnalyserNode` driver
    (RMS→`jawOpen`, spectral-centroid→vowel viseme, HF-ratio→fricative) returns `viseme_*`+jaw
    target weights; `useFrame` damps them onto the substrate. Strict ownership (lip-sync owns ONLY
    jaw/mouth/viseme). A `DEV_LIPSYNC_TEST` flag plays a sample clip so the mouth moves on web; the
    pulse also reacts to speak energy (`uSpeak`/`uPeriod`). `wawa-lipsync` adapter behind an inert
    `USE_WAWA` flag (its visemes are identity-mapped to RPM names) — flip after `npm i wawa-lipsync`.
  - **Liveliness** (unchanged): blink, eye saccades, Head/Neck sway, brow flashes, resting smile.
  - **Verified on web** (two-frame capture): a clean, clearly-female glowing plexus face; the
    thought-pulse visibly travels (crown→jaw between frames); eyes/lips luminous.
- Reached via the dev-only **"Lab"** tab → `/playground` (renders `venus-head-scene`).

### The avatar
- **Demo (POC only):** `https://raw.githubusercontent.com/met4citizen/TalkingHead/main/avatars/brunette.glb`
  — verified female RPM avatar, 72 morph targets, **full ARKit + Oculus visemes**.
  ⚠️ **CC BY-NC 4.0 (non-commercial)** — placeholder only, must NOT ship.
- **Production:** the user's **own Ready Player Me Venus** (they own/license it). Create at
  [readyplayer.me](https://readyplayer.me) → GLB at `https://models.readyplayer.me/<id>.glb`,
  append `?morphTargets=ARKit,Oculus Visemes`. **Swap `AVATAR_URL`** — that's the only change.
  (RPM was unreachable from this machine *and* the user's network during the build — likely a
  transient/regional block; `models.readyplayer.me` returned `000`. Retry later, or use the
  other GitHub-hosted female GLBs below.)
- **Other verified female GLBs (GitHub-hosted, visemes + ARKit), reachable here:**
  - `.../met4citizen/TalkingHead/main/avatars/brunette-t.glb` (same avatar, T-pose, 67 targets)
  - `.../wass08/r3f-virtual-girlfriend-frontend/main/public/models/64f1a714fe61576b46f27ca2.glb`
  - *(Rejected: `wass08/r3f-lipsync-tutorial/.../646d9dc...glb` has visemes but NO ARKit; a
    "Teacher_Nanami" GLB had numbered targets, no visemes.)*

### The rig (verified, from a research workflow this session)
- **ARKit 52** blendshapes (exact camelCase): brows (5), eyes (14: blink/look*/squint/wide),
  cheeks (3), nose (2), jaw (4), mouth (23), tongue (1).
- **15 Oculus visemes** (separate set): `viseme_sil/PP/FF/TH/DD/kk/CH/SS/nn/RR/aa/E/I/O/U`.
- **Bones** (PascalCase, **no `mixamorig:` prefix** in the GLB): `Head, Neck, Spine, Spine1,
  Spine2, Hips, LeftShoulder, RightShoulder, LeftEye, RightEye`.

### Liveliness recipe (implemented in `venus-head-scene.tsx`; full version from the workflow)
- **Blink** (highest-impact): `eyeBlinkLeft/Right` together, fast close (easeIn ~70ms) +
  open (easeOut ~80-100ms) to peak 1.0, every **4s ±2s** (faster while speaking), ~8% double
  blinks, slight asymmetry. (Demo uses a simple `sin(p·π)` 0→1→0 over 140ms.)
- **Micro-saccades**: rotate `LeftEye/RightEye` bones (or `eyeLook*` pairs) ±1-2°, new target
  every 0.3-1.2s, snap 30-50ms; larger aversion gazes ±10-20° every 4-10s; **freeze during a
  blink**.
- **Idle head/neck/spine**: sum prime-incommensurate sines (or Perlin) added to the bone's
  **captured REST rotation** (never accumulate). Head ±1.5-2.5°, Neck ±1-1.5°, Spine ±0.5-1.5°,
  periods 4-12s; Head counter-rotates Neck to keep gaze level. Breathing ~0.25 Hz on Spine2/
  shoulders; slow weight-shift sway.
- **Brows**: baseline `browInnerUp` ≈ 0.04 + asymmetric **flashes** to 0.15-0.35 every 3-8s /
  on speech onset.
- **Resting expression**: faint `mouthSmileLeft/Right` ≈ 0.08-0.12 (Mona-Lisa, not a grin),
  gaze toward camera with periodic aversion + listening nods.
- **Blending (the architecture):** strict **ownership** — **lip-sync OWNS** `jawOpen` + all
  viseme/mouth shapes (override authoritatively); **idle OWNS** eyes, brows, head/neck bones
  (additive). The sets are disjoint so they can't fight. Only overlap = the rest smile vs
  speech: crossfade the smile down to ~0.3× while speaking. **Never hard-set** influences —
  `THREE.MathUtils.damp(value, target, lambda, dt)` each frame (lambda 15-20 crisp visemes,
  3-6 smooth head, mid for eyes/brows); drive the blink as a direct one-shot curve. Clamp to
  [0,1]; zero the losing side of antagonist pairs (eyeLookIn/Out, browUp/Down, smile/frown).

## What's next (the runway, in priority order)
1. ✅ **DONE — Real lip-sync driver** (`src/lib/venus-lipsync.ts`) + the **"Ascendant Cortana" look**
   (aurora duotone, thought-pulse, core glow, aura, blip) + the **hair/face clean-up**. Verified on
   web. Remaining within these: tune the lip-sync thresholds to Venus's actual TTS voice (the test
   clip is generic), and the **N1 reactive coupling** is only lightly wired (`uSpeak` from jaw
   energy) — deepen it when live audio lands (listening/thinking vs speaking states).
2. **Wire Gemini Live PCM → the driver**: we already receive/play her audio — tap those chunks.
   On web that's `connect(htmlAudioElement)`. On **native** there is no `AudioContext`, so this is a
   separate bridge (render the avatar in a WebView, or compute visemes from PCM frames with a tiny
   FFT — `sample()`'s math ports; `connect(HTMLMediaElement)` does not).
3. **The dots-morph reveal**: she **assembles from the background dot field** (scatter→face),
   talks, disperses. Either combine with the Skia dot field (`dot-field-scene.tsx`) or do the
   morph in R3F by lerping the head's vertices from scattered homes → bind positions. The Skia
   morph already exists in `venus-field-scene.tsx` (canonical-mesh version) as a reference.
4. **Swap in the user's own RPM Venus avatar** (URL swap; commercial license).
5. **Integrate into Studio**: replace the orb (`src/components/venus-orb.tsx` / the nucleus in
   `studio.tsx`); drive from **real Gemini Live audio**; show her while she speaks (push-to-talk
   already gates *when*). **Verify on a native dev build** (R3F-native + expo-gl).

## Gotchas (read before editing)
- **TEMP `_layout` bypass — MUST REVERT before shipping.** `src/app/_layout.tsx` currently
  renders `<Playground/>` directly (inside `{false && (<><AppBackground/><AnimatedSplashOverlay/>
  <AppTabs/></>)}` + `<Playground/>`) so the **Lab renders on web** (NativeTabs-web only renders
  the *initial* tab, so `/playground` won't show otherwise). Revert to
  `<AppBackground/><AnimatedSplashOverlay/><AppTabs/>`. This bypass is **uncommitted**.
- **drei `useGLTF` breaks under Metro** — it wires DRACO/meshopt loaders that use `import.meta`,
  which Metro can't eval ("Cannot use 'import.meta' outside a module"). Use a **plain three
  `GLTFLoader`** (`three/examples/jsm/loaders/GLTFLoader.js`). RPM GLBs aren't draco-compressed.
- **Skinned-mesh bboxes are wrong**: RPM meshes are `SkinnedMesh`; `Box3.setFromObject(headMesh)`
  returns a tiny (~6 cm) bind-pose box. **Frame off the whole-scene bbox** (the avatar is ~1.85 m,
  head at the top) — see the framing code.
- **Frame the camera BEFORE adding the aura plane.** `setFromObject(gltf.scene)` includes every
  child — the aura `PlaneGeometry` inflated the bbox and shrank/dropped the head until the aura was
  added *after* the framing block. Any large helper object must be added post-framing (or excluded).
- **Glow shell is STATIC, parented to the `Head` bone**, built once at load (`bakeHeadLocal` bakes
  face geometry into head-local space → `mergeVertices` welds seams). It shares head sway for free
  and costs nothing per frame. The **mouth/eyes still move** because the dim *real* morph mesh stays
  in the scene underneath — never re-derive posed vertices per frame (kills FPS on device).
- **Custom node shader uses `ShaderMaterial` with `vertexColors: true`** so three injects the
  `color` attribute (the baked aurora gradient); the shader declares only `aY`/`aRand` + varyings.
  Keep GLSL **ES2-safe** (`precision mediump`, no `#version 300`, no dynamic loops) for expo-gl.
- **Apply morphs to all meshes**, not just one — visemes are on the head, but iterate every mesh
  with a `morphTargetDictionary` and set the index if present.
- **The preview console buffer does NOT clear on reload** — stale errors (e.g. a transient
  `hairMesh is not defined` from a bundle that raced Metro's recompile) persist across reloads.
  Trust the **screenshot**, not a lingering console error, once `tsc` is clean.
- **Lip-sync needs CORS**: `createMediaElementSource` on a cross-origin clip without
  `crossOrigin="anonymous"` + an `Access-Control-Allow-Origin` header reads a tainted (all-zero)
  stream → the mouth never moves. Host Venus's real TTS same-origin to sidestep it.
- **`models.readyplayer.me` is network-blocked here** (and was for the user) — that's why we use
  GitHub-hosted sample GLBs. The browser preview *can* reach GitHub raw + CDNs.
- **Expo dev server can die** mid-session (saw the preview drift to the nanocrew-site on :3000).
  If the app screen shows the marketing landing, the Expo server on :19010 is down — restart the
  `web-preview` preview server.
- R3F renders on web via WebGL with no special loader; **native** uses `expo-gl` and needs a
  **dev build** (Skia + expo-gl are native modules) — not yet verified on device.

## File map
- `src/components/backgrounds/venus-head-scene.tsx` — **the live R3F POC** ("Ascendant Cortana":
  clean female face, glow shell + thought-pulse, liveliness, real lip-sync wiring). ← work here.
- `src/lib/venus-lipsync.ts` — the **audio→viseme driver** (zero-dep Web-Audio AnalyserNode; wawa
  adapter behind `USE_WAWA`). Returns `viseme_*`+jaw target weights for `useFrame` to damp.
- `src/components/backgrounds/venus-field-scene.tsx` — earlier Skia canonical-mesh dots-morph
  (scatter↔face + wireframe). Reference for the dots-morph reveal.
- `src/components/backgrounds/face-mesh.ts` — canonical face mesh data (FACE_VERTS/EDGES/DOTS).
- `src/app/playground.tsx` — the Lab; renders `venus-head-scene`. Dev-only, `__DEV__` guarded.
- `src/components/backgrounds/dot-field-scene.tsx` + `app-background.tsx` — the **Skia dot-field
  background** (separate, shipped: global continuous bg behind the tabs, scrim, focus, etc. — see
  the `skia-playground` memory).

## Git / how to verify
- Branch `feature/welcome-onboarding`. Venus-arc commits: `1d68065` (canonical morph, superseded)
  → `eeaa481` (dense dots, superseded) → `5528225` (R3F+GLTF wireframe) → `9967677` (RPM head +
  viseme) → `3c263f2` (female head + liveliness). Background-system commits: `66b0535`, `672578a`,
  `84b087a`, `91d9002`.
- Verify on web: start the `web-preview` preview server; with the `_layout` bypass on, the Lab
  (`venus-head-scene`) renders. `npx tsc --noEmit` must pass before committing; `git push` only
  when the user asks.
