# Venus — the talking 3D avatar (live build)

> **Status: POC, in progress.** Branch `feature/welcome-onboarding`. Verified on the web
> preview AND on a native iOS dev build (expo-gl). Surfaced in-app as a gated test tool on the
> Account screen, AND now live (behind `VENUS_IN_INTERVIEW`) as the full-bleed avatar in the Studio
> build-a-brand voice interview, replacing the SVG orb. This doc is the source of truth for the
> Venus-avatar work — read it before continuing.

## 🛠 THE VENUS LAB — where we work on her appearance (read this first)
**When the user says we're going to edit / work on Venus's appearance, come HERE — this is our
dedicated, permanent tool for it.**
- **What it is:** a full-screen render of the live avatar (`src/components/backgrounds/
  venus-head-scene.tsx`) with a 4-stage toggle row, so we iterate on her in isolation (no app
  chrome). The screen is `src/components/venus-lab-screen.tsx`; the avatar comes from `<VenusLab>`
  (`src/components/venus-lab.tsx` native / `.web.tsx` web — a component split that keeps three/R3F
  out of the native bundle until the Lab is opened).
- **How to enter it (in the app):** Account screen → **Developer → "Venus Lab (test)"** opens it as
  a full-screen Modal; the **"‹ back"** button returns to Account. The row is gated to the tester
  account (`VENUS_LAB_EMAIL = josephsardella@gmail.com` in `src/app/account.tsx`) — invisible to
  everyone else. It works on a native dev build AND in production builds for that one email.
- **How to view it live on web (fast iteration loop):** the avatar renders in the `web-preview`
  server. Edit `venus-head-scene.tsx` (and the hair/eye/shader helpers in the same file) →
  `npx tsc --noEmit` → reload the preview → screenshot to verify. Almost all of Venus's look lives
  in that ONE file (shaders, the procedural bob, the eyes, the liveliness).
- **Commit cadence:** commit at each visual milestone; this doc gets updated in the same change.

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
- **Palette** — one hue family, cyan/teal, never warm/gold (brand rule). The FACE is a **single
  consistent cyan `#5BD8E6`** (`bakeAurora`) — the old positional aurora (cyan→periwinkle→violet by
  height + a grazing-normal violet shift) discoloured the neck/sides vs the front of the face, so it
  was flattened to one colour per Joe ("keep a consistent color throughout the face"). Navy-black bg
  `#06080f`.
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
    `uViewRot`/`uTime`), over a **root→tip PINK gradient** (`uTip #db6fae`, `uRim #ff9ed0`, plum root
    — per Joe; the face stays blue so it's a pink-hair / blue-face contrast), **procedural strand
    striations**, a soft **fresnel rim**, a **feathered A-line hem** + crisp fringe edge, and a
    **gentle WAVE** — body tips sway (scaled by `aRoot²` so roots stay anchored) while the **FRINGE
    flutters at its bang-tips** (mixed in by `aFringe`, sways where `aEdgeF`≈0), all off `uTime`
    (`uWaveAmp`/`uWaveSpeed`). `NormalBlending`, `uBaseAlpha` 0.74 — fairly OPAQUE (0.5 left the crown,
    where fresnel is weak, too see-through). Length/shape
    via the `BOB_*` consts (`BOB_LEN` negative = below the chin, `BOB_TILT` = A-line); the profile is
    parameterized by **head-fraction** so proportions stay stable as it lengthens. ES2/expo-gl-safe (no
    postprocessing, no loops/dFdx; `mediump`→`highp` if the crown band crawls). The 5 uniforms worth
    eyeballing: `uBaseAlpha`, `uShift1/2`, `uStrandCount`, `uExp1/2`, `uWaveAmp`.
  - **Hair occlusion** (so waving strands don't vanish, and the back of the hair doesn't show
    through the translucent face): the hair is `side: DoubleSide` (the INSIDE renders too — a backface
    flip + inside-dim in `HAIR_FRAG` keeps it shaded sanely), and a **solid dark FILL of the face +
    neck** (a `Wolf3D_Head` mesh, dark color `#05090f` — the "blackness", `renderOrder -10`,
    `polygonOffset` to clear the skinned/bind-pose mismatch so the glowing wireframe sits in front) that
    doubles as the depth occluder: hair BEHIND the face is hidden, front hair (bangs/sides) covers the
    face, and the flowing bottom strands (not behind the head) still draw.
  - **Ears removed two ways** so they don't poke out from under the bob: the bright ear geometry is
    dropped from the face shell (`dropEars`, `EAR_DROP_FRAC`), AND the dim substrate is clipped at the
    ear line (two world-space `THREE.Plane`s on the substrate materials, `gl.localClippingEnabled`).
    **Note:** the procedural bob is the demo workaround — the user's own RPM Venus with a real bob asset
    (URL swap) is the production answer; RPM was unreachable when built.
  - **Eyes — a SCLERA + readable IRIS that LOOK AT the user:** a **sclera** (eye-white) sprite — a
    soft almond *ring* (`makeScleraTexture`, hole in the centre so the iris/pupil show through), color
    `SCLERA_COLOR` — behind an **iris** sprite (`makeIrisTexture`: dark pupil + bright limbal ring +
    striations + catchlight) over a faint halo. The three are **grouped at the origin and the group is
    AIMED at the camera each frame** (in `useFrame`: world gaze dir → eye-bone local → `position =
    dir·EYE_R`), with a small **saccade drift** added to the target so she looks *at/around* the user,
    not off into space. (The old approach — a fixed `+z` offset on the eye bone — read as "looking up"
    because the bone's local axis doesn't point at the camera.) Additive, `depthTest:false` over the
    dark face fill; the alpha-0 pupil stays dark; hidden until `R>0.66` during the reveal.
  - **Two-layer render:** a constant-color morph-driven substrate (`MeshBasicMaterial` wireframe,
    opacity **0.16**, all 4 face meshes) carries lip-sync + blink — this is the ONLY layer that
    actually deforms (the bright shell is static/bind-pose), so its opacity is what makes the **mouth
    visibly move when she speaks**; if the face reads too busy, the cleaner alternative is a targeted
    mouth-only brighten (`onBeforeCompile` modulating alpha by rest-position near the mouth) instead of
    raising the whole substrate. UNDER a **bright static glow shell** parented to the `Head` bone
    (built once via `bakeHeadLocal` → head-local geometry →
    `mergeVertices`): aurora-gradient **nodes** (a `ShaderMaterial` carrying the thought-pulse) +
    node halo + `EdgesGeometry` lines + a fresnel **core-glow** sphere; plus a billboarded
    **aura pool**. All additive (no postprocessing); GLSL is ES2/expo-gl-safe.
  - **"Refined" pass** (user direction — *cleaner, structure-led*): the glow shell is built from the
    face SKIN only (`SHELL_NAMES = ['Wolf3D_Head']`) so the eyeballs + teeth stay on the dim
    substrate (clean sockets, no bright eye-blobs); **edges lead** (opacity 0.36) over a sparser
    (`subsample` stride 3), smaller node field; tighter halo (0.12), subtler pulse crest, dimmer
    core/aura/hair. The tuning lives in a few constants — easy to push back toward "vivid."
  - **Real lip-sync** (`src/lib/venus-lipsync.ts`): the driver returns `viseme_*`+jaw target weights
    each frame; `useFrame` damps them onto the substrate. Strict ownership (lip-sync owns ONLY
    jaw/mouth/viseme). Two real sources, by platform:
    - **Native (Studio interview)** — `SpeechLevelDriver` reads `src/lib/venus-speech-level.ts`, a
      time-synced envelope of Venus's ACTUAL spoken PCM. `live-voice.ts` pushes every decoded 24 kHz
      chunk (the exact samples it enqueues for playback) into that module aligned to when it becomes
      audible; the driver maps **loudness (RMS) → jaw openness** (silent between words ⇒ mouth closed)
      and **brightness (zero-crossing-rate) → vowel SHAPE** — a crossfade dark→rounded `O`,
      mid→open `aa`, bright→spread `E`, plus vowel-vs-sibilant (so it doesn't round into "O" on every
      syllable; the mouth shape follows the real sound). `setVenusSpeechLatency(ms)` (default 120) shifts
      the envelope to match ear-to-lip; tune on device. No FFT, no second audio graph — it analyses
      the bytes being played. (Lip-sync keeps running while her buffered audio finishes, even after
      the turn-complete flips state to listening.)
    - **Web (test harness)** — a zero-dep Web-Audio `AnalyserNode` driver (RMS→jaw,
      spectral-centroid→vowel, HF-ratio→fricative). A `DEV_LIPSYNC_TEST` flag plays a sample clip so
      the mouth moves on web AND drives a SYNTHETIC flap in the Lab when there's no real audio (it is
      suppressed whenever a real source is `speaking()`, so it never desyncs Studio). `wawa-lipsync`
      adapter behind an inert `USE_WAWA` flag — flip after `npm i wawa-lipsync`.
  - **Liveliness** (unchanged): blink, eye saccades, Head/Neck sway, brow flashes, resting smile.
  - **Verified on web** (two-frame capture): a clean, clearly-female glowing plexus face; the
    thought-pulse visibly travels (crown→jaw between frames); eyes/lips luminous.
- Reached via the gated **Account → Developer → "Venus Lab (test)"** tool (`venus-lab-screen.tsx`
  renders `venus-head-scene`).

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
3. ✅ **DONE (v2) — the UNIFIED LATTICE: one field that IS the background AND becomes her.** Per Joe:
   "Venus and the background are part of one singular superintelligence… our background needs to morph
   with it into her." The old design was two *renderers* (a Skia background that just faded + a separate
   R3F grid that merely *matched* it). Now there is **one R3F points buffer** (`bakeUnifiedLattice` +
   `LATTICE_VERT/FRAG` in **`venus-points.ts`**) that is the ambient dot-field at rest and reorganises
   into Venus on morph — the dots that become her are **literally background dots that peel up**.
   - **One lattice, `aIsFace` branches the two behaviours.** A screen-filling grid (`LAT_COLS×LAT_ROWS
     = 84×56 = 4704` dots) lives in its OWN **scene-root group** in world space (the camera is FIXED at
     `(0,eyeY,0.99)` looking down −Z, so the group is a screen-facing plane — no per-frame billboard).
     Each dot bakes `aHome` (its grid cell), `aCell`/`aDCenter` (the Skia hue/energy/vignette inputs),
     and `aTarget` (= `aHome` for ambient dots). A ~`subsample(faceGeo,3)` subset (~900 dots) is tagged
     `aIsFace=1` by **greedy nearest-unclaimed-cell** (face verts sorted deterministically by group-space
     y/x), each claiming the nearest grid cell and storing the **exact face vertex** as `aTarget` + the
     aurora `color` + the cyclone attrs (`aDelay`/`aRadius`/`aSpan`, identical formula to the old
     `bakeAssemble`). So her dots are real cells of the field that **detach, leaving a gap**.
   - **The shader computes BOTH branches and blends — never a divergent `if`.** `pAmb` = the Skia look
     at `aHome` (the ported `SKIA_CHUNK`: hash/hsv/5-pattern `motionEnergy`, drift scrolls the *pattern*
     via `cell`, NOT the dot positions — translating finite points would march them off-screen) + a
     ≤10% inward **pulse** toward `uCenter`. `pCyc` = the tornado (today's cyclone verbatim, `aHome→
     aTarget`). `peel = smoothstep(0,0.18,lp)·aIsFace`; `p = mix(pAmb, pCyc, peel)`. **The invisibility-
     bug fix:** `vGlow` *starts* at the ambient `ambVal` and *adds* the flight spark/aurora as it peels
     — dots brighten and lift, they do **not** pop in. At land, `landFade = 1−land·0.85` fades the dot
     glow so the formed look hands off to the (byte-for-byte unchanged) swaying edges/occluder/bob.
   - **The residual STREAM shell (`bakeStreamField`, 700 dots, head-local)** is kept as the **3D depth-
     feed** — the lattice gives the in-plane pulse, the shell adds volumetric inflow. Together: "dots as
     background still, pulsing towards Venus."
   - **One reveal clock** in `useFrame` drives `uMorph = seg(0.10,0.62)` (the peel/cyclone window) + the
     `uPulse` ramp (0.12 at rest → ~1.0 mid-morph → ~0.5 formed) + Skia's 12-s pattern crossfade
     (`motionSelect(t)` → `uSelA/uSelB/uFade`) + `uDrift`. Then the structure layers fade in on the
     existing timing table — edges/substrate (0.62–0.78), hair (`uFade` 0.55–0.76) + core (0.6–0.8)
     fade in TOGETHER with the structure (was 0.68–0.92 — the hair popped in last; per Joe everything
     loads together now) → aura (0.85–1.0); eyes + micro-life gate on when formed; **`R=1` is the
     approved look**
     (carried by the untouched swaying meshes). `glowPts` is gone (its bloom is `LATTICE_FRAG`'s
     `a += 0.4·a²`); `NODE_VERT/FRAG` and `bakeAssemble` are removed.
   - **Driven by the `VenusStage` prop** (exported): `pre-render` (`revealTarget 0`, the full ambient
     field) · `morphing` (peel + cyclone, ping-ponged every 4.5 s) · `silence` (formed + listening) ·
     `talking` (formed + lip-sync). The **Lab** (`venus-lab-screen.tsx`) has the 4-stage toggle row and
     **no longer renders the Skia `<AppBackground>`** — the lattice IS the background inside the transparent
     canvas, over the `#06080f` bed.
   - **Talking = a BOTTOM→TOP light wave on the dots (DONE).** Per Joe ("the dots kind of light up some
     of her mesh from bottom to top when she's talking"): `LATTICE_VERT` sweeps a bright band UP her
     face dots — `wave = fract(uTime·0.5)` (0 bottom → 1 top, ~2 s), `band = exp(-(aFaceY-wave)²·55)`,
     punched by jawOpen (`uSpeak`). `aFaceY` is each face dot's baked height (the `wipe` array; 0 chin/
     neck … 1 crown). Gated by `uTalk` (smoothed `talkingRef`) + `aIsFace`, so only her face dots light
     and only while talking. (The earlier mouth-glow pool and the lip-converging rings were removed.)
     The substrate wireframe also keeps a small jawOpen punch so the mouth stays readable even though
     talking is dimmer overall (see brightness model below).
   - **No BLEED-THROUGH / DEFORMING dark fill (DONE).** The wireframe is additive with `depthWrite:false`,
     so with nothing solid behind it you see straight THROUGH to the interior/back mesh (the visible
     "bleed-through": a second layer of wireframe showing through the front). The dark fill must occlude
     that interior — but a **static** fill (the old closed-mouth `rawFace`) stops matching the face the
     moment the jaw moves, so the interior bleeds through (and a big polygon-offset hack to keep the
     open-mouth wireframe drawing just pushed the fill's depth so far back that the **background dots
     bled through her face** — wrong fix, reverted). The real fix: the occluder is now a **dark-fill
     DUPLICATE of each face mesh** (`for (src of meshes) src.clone()` — `clone()` shares the skeleton for
     SkinnedMesh — set `occluderMat`, and **share `morphTargetInfluences`** so it deforms identically),
     `side: DoubleSide` (so the open mouth shows dark interior, not background), `renderOrder -10`,
     `depthWrite` gated `R>0.5`, small `polygonOffset 4/4` to keep the coincident wireframe just in
     front. It writes depth at the ACTUAL (deformed) face surface, so the front wireframe stays a clean
     single layer everywhere (mouth open included) and the interior/background are occluded — no
     bleed-through, no black cull, no x-ray. `occluderMat` (one shared material) carries the opacity/
     depthWrite/teal-lift in `useFrame`. **The occluder is EAR-CLIPPED** with the same `earPlanes` as the
     substrate — otherwise the dark fill writes depth at the ears and punches them through the
     (translucent) hair; clipping lets the hair cover the ears.
   - **Brightness model — both states CLOSE, a touch brighter SPEAKING (DONE).** Per Joe (after a
     few passes): silence and talking should sit near the same brightness, just slightly brighter while
     speaking. One scalar drives it all: `lit = 0.88 + 0.12·talk + 0.06·speak·talk` (silent 0.88,
     talking ~1.0+). Applied to the wireframe (`subA = 0.32·lit·seg`), edges (`0.40·lit·seg`), and the
     occluder fill — a **FULL BLUE** `rgb(0.05, 0.21, 0.46)·lit`. The fill is the **consistent base
     colour** of the whole head: a dim teal lift left the dense-wireframe cheek/jaw reading darker than
     the sparse-wireframe neck ("the face is darker"), so a solid blue tint (the red-fill diagnostic
     proved the fill covers the whole face+neck) makes the entire head one cohesive colour. Tune the
     `lit` constants / the fill rgb.
   - **Tuning knobs:** `LAT_COLS/LAT_ROWS` (density; drop to 60×40 on a slow device), `bakeUnifiedLattice`
     span (`vW/vH × 2.0`) + greedy claim + the lip-band (`aY 0.20–0.40`), `LATTICE_VERT` `uSwirl/uUpdraft/
     uInfall` + the `fly·0.9` pinch, the `uPulse` curve + `basePx`, the lip energy (`uTime·0.6` ring rate,
     the speech wave (`uTime·0.5` rise rate, `55` band width, `uSpeak` punch) + the `lit` brightness
     factor (`subA`/edges/fill multipliers), `bakeStreamField` count, the `seg(...)`.
   - **⚠ Sync point:** the Skia look now lives in **TWO** places — `dot-field-scene.tsx` (SKSL, still the
     app-wide Account/Market/Account background via `<AppBackground>`) and `venus-points.ts`
     `SKIA_CHUNK` (the GLSL port). If the dot-field look is retuned, change BOTH (the constants are
     copied verbatim, so the diff is mechanical).
   - **NOTE — judge the morph LIVE, not from stills:** the peel + cyclone is a *motion* effect (~1.3 s);
     a single screenshot is one frame. Use the Lab's **morphing** toggle to evaluate it.
   - **Remaining polish:** make the *app-wide* background this same R3F field (today only the Lab/Venus
     screens use the lattice; the rest of the app keeps the cheap Skia `<AppBackground>`). The landed
     face dots sit in the static group while the wireframe sways ±2° — fine because they fade at land,
     but head-parenting the landed subset (keeping them sparkling on the moving mesh) is a future option.
4. **Swap in the user's own RPM Venus avatar** (URL swap; commercial license).
5. **Integrate into Studio** — ✅ DONE (first pass). The voice **build-a-brand interview** now renders
   `<VenusAvatar>` full-bleed behind the controls instead of the SVG nucleus orb, gated by
   `VENUS_IN_INTERVIEW` in `studio.tsx`. Her `VenusStage` is derived from the interview's
   `EntityState` (`venusStageFor`): `speaking → talking`, everything else → `silence`, with a
   one-shot `morphing` materialize when she enters the view. The dark `venusBackdrop` hides the
   screen-level Skia field so only her lattice shows. **Native lip-sync is wired** (her mouth tracks
   the real Gemini PCM — see "Real lip-sync" above). **Remaining:** tune `setVenusSpeechLatency` on
   device; a tap-to-pause hit-target on her face; tune the framing/controls.

## Gotchas (read before editing)
- **The Venus Lab is opened from the Account screen** (Developer → "Venus Lab (test)", gated to
  `VENUS_LAB_EMAIL`) as a full-screen Modal rendering `venus-lab-screen.tsx` — see "The Venus Lab"
  section above. It's a real (if gated) surface now, so `<VenusLab>` is a **component split**
  (`venus-lab.tsx` native / `.web.tsx` web): the native `require` of `venus-head-scene` (three/R3F)
  is paid for only when the Lab is mounted. No more `_layout` flag — the old `/playground` route is
  gone.
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
  **dev build** (Skia + expo-gl are native modules) — now verified running on a native iOS dev build.
  Native gotchas that bit us: hair shaders need `precision highp` (mediump underflowed → hair vanished);
  GPU clip planes don't apply reliably on expo-gl (use geometry/`polygonOffset`, not `clippingPlanes`);
  `three`'s ES static class blocks need `@babel/plugin-transform-class-static-block` (`babel.config.js`);
  and Web Audio is web-only — on native, lip-sync runs off the real spoken-audio envelope
  (`venus-speech-level.ts` fed by `live-voice.ts`), not an `AnalyserNode`.

## File map
- `src/components/backgrounds/venus-head-scene.tsx` — **the live R3F POC** ("Ascendant Cortana":
  clean female face, glow shell + thought-pulse, liveliness, real lip-sync wiring). ← work here.
- `src/lib/venus-lipsync.ts` — the **audio→viseme driver**: `SpeechLevelDriver` (native, reads the
  real-PCM envelope) / Web-Audio `AnalyserNode` driver (web) / wawa adapter behind `USE_WAWA`.
  Returns `viseme_*`+jaw target weights for `useFrame` to damp. `speaking()` tells the scene a real
  source is active (so the synthetic flap stays off).
- `src/lib/venus-speech-level.ts` — zero-dep, time-synced **loudness+ZCR envelope** of Venus's
  spoken PCM. `live-voice.ts` pushes each enqueued chunk; the native driver reads `speechFrameAt()`.
  `setVenusSpeechLatency(ms)` aligns lips to the ear.
- `src/lib/live-voice.ts` — the **Gemini Live session** (mic up / 24 kHz PCM playback via
  react-native-audio-api). Feeds `venus-speech-level.ts` as it enqueues her audio.
- `src/components/backgrounds/venus-field-scene.tsx` — earlier Skia canonical-mesh dots-morph
  (scatter↔face + wireframe). Reference for the dots-morph reveal.
- `src/components/backgrounds/face-mesh.ts` — canonical face mesh data (FACE_VERTS/EDGES/DOTS).
- `src/components/venus-lab-screen.tsx` — the Lab UI (4-stage toggle + back); opened from Account.
- `src/components/venus-avatar.tsx` / `.web.tsx` — the `<VenusAvatar>` component split (native
  expo-gl / web R3F) that renders `venus-head-scene`, keeping three out of the native bundle until
  mounted. Used by BOTH the Lab and the Studio interview.
- `src/app/studio.tsx` — the **build-a-brand interview** mounts `<VenusAvatar>` full-bleed in voice
  mode (`VENUS_IN_INTERVIEW` flag, `venusStageFor` maps live state → stage). Legacy SVG orb
  (`NCNucleus`/`Nucleus`) still in-file as the `false` fallback.
- `src/components/backgrounds/dot-field-scene.tsx` + `app-background.tsx` — the **Skia dot-field
  background** (separate, shipped: global continuous bg behind the tabs, scrim, focus, etc. — see
  the `skia-playground` memory).

## Git / how to verify
- Branch `feature/welcome-onboarding`. Venus-arc commits: `1d68065` (canonical morph, superseded)
  → `eeaa481` (dense dots, superseded) → `5528225` (R3F+GLTF wireframe) → `9967677` (RPM head +
  viseme) → `3c263f2` (female head + liveliness). Background-system commits: `66b0535`, `672578a`,
  `84b087a`, `91d9002`.
- Verify on web: start the `web-preview` preview server; the Lab avatar (`venus-head-scene`)
  renders directly. `npx tsc --noEmit` must pass before committing. Verify the native bundle with
  `npx expo export --platform ios` (three is now reachable in the production bundle via the gated
  Lab, so the babel static-block plugin must compile it).
