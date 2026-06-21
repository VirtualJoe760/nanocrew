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

## Current state (what works, verified on web)
- 3D stack installed: `three` ^0.184, `@react-three/fiber` ^9 (R3F v9, React 19),
  `@react-three/drei` ^10, `expo-gl` ~16. (R3F renders on web via plain WebGL; on native it
  uses expo-gl — **native not yet verified**.)
- **`src/components/backgrounds/venus-head-scene.tsx`** (the live POC, rendered by the Lab):
  - Loads a **female** RPM head GLB via a **plain three `GLTFLoader`** (see gotchas — NOT
    drei's `useGLTF`).
  - Renders every mesh as a cyan (`#7cc7df`) **wireframe** (`MeshBasicMaterial wireframe`).
  - Frames the **face** off the known avatar scale (the head is at the top of a ~1.85 m body).
  - Runs a per-frame **liveliness loop** (blink, eye saccades, Head/Neck sway, brow flashes,
    resting smile) **+ a `viseme_aa` lip-sync TEST pulse** (placeholder for real audio).
  - Result: a defined female wireframe face that **blinks, sways, and talks** — proven alive.
- Reached via the dev-only **"Lab"** tab → `/playground` (`src/app/playground.tsx` renders
  `venus-head-scene`).

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
1. **Real lip-sync** (the payoff): replace the `viseme_aa` TEST pulse with an **audio→viseme
   driver**. Use **`wawa-lipsync`** (FFT → viseme weights) or roll amplitude→`jawOpen` +
   spectral→vowel visemes. Test on a **sample speech clip** in the preview first (no Gemini
   needed), then wire **Gemini Live PCM** (we already receive/play her audio — tap those
   chunks). Drive the `viseme_*` set; let the idle layer keep eyes/brows/head.
2. **The look**: render the wireframe as **glowing nodes + edges** (points at vertices),
   **decimate** the dense RPM head for a cleaner "plexus", cool/iridescent color (cycle hue
   like the dot field), bloom/glow, a slow turn for depth, optional dot-field **aura** around her.
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
- **Apply morphs to all meshes**, not just one — visemes are on the head, but iterate every mesh
  with a `morphTargetDictionary` and set the index if present.
- **`models.readyplayer.me` is network-blocked here** (and was for the user) — that's why we use
  GitHub-hosted sample GLBs. The browser preview *can* reach GitHub raw + CDNs.
- **Expo dev server can die** mid-session (saw the preview drift to the nanocrew-site on :3000).
  If the app screen shows the marketing landing, the Expo server on :19010 is down — restart the
  `web-preview` preview server.
- R3F renders on web via WebGL with no special loader; **native** uses `expo-gl` and needs a
  **dev build** (Skia + expo-gl are native modules) — not yet verified on device.

## File map
- `src/components/backgrounds/venus-head-scene.tsx` — **the live R3F POC** (female RPM head,
  wireframe, liveliness loop, viseme test). ← work here.
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
