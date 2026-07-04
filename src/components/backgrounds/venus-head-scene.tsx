import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  createVenusLipsync,
  LIPSYNC_MORPHS,
  type VenusLipsync,
  type VisemeWeights,
} from '@/lib/venus-lipsync';
import { LATTICE_VERT, LATTICE_FRAG, motionSelect } from './venus-points';
import { STREAM_VERT, STREAM_FRAG, CORE_VERT, CORE_FRAG } from './venus-shaders';
import {
  makeDotTexture, makeAuraTexture, makeSkinMatcap, makeIrisTexture, makeScleraTexture,
} from './venus-textures';
import {
  bakeHeadLocal, dropEars, dropAbove, bakeAurora, subsample, bakeUnifiedLattice, bakeStreamField, LAT_ROWS,
} from './venus-geometry';
import { buildBobHair, buildHairStrands } from './venus-hair';
import { makeIris, EYE_R } from './venus-eyes';

// ── Venus head — "Ascendant Cortana" (R3F) ──────────────────────────────────
// A FEMALE Ready Player Me head rendered as a glowing "plexus" wireframe FACE,
// graded as a Cortana-inspired super-intelligence: a positional aurora duotone
// (cyan→periwinkle→violet by height + grazing normal), a travelling THOUGHT-PULSE
// that sweeps up the mesh like neural activation (you see her think), an inner
// core glow, an aura pool she sits in, and one rare holographic "blip". The face
// stays alive (blink, saccades, brow, sway) and the mouth lip-syncs to REAL audio.
//
// Architecture (keeps it cheap + correct):
//   • DIM morph-driven substrate mesh  → carries lip-sync + blink (constant color)
//   • BRIGHT static glow shell under Head bone → nodes (ShaderMaterial + pulse) +
//     halo + EdgesGeometry + core-glow sphere; built ONCE, shares head sway.
//   • Hair → a faint contour that frames her (no tangle over the face).
// All bloom is additive layering (no postprocessing); GLSL is ES2/expo-gl-safe.
// Web entry for now — the @react-three/fiber/native swap for expo-gl is a later
// step. Demo avatar is CC BY-NC; the user's own licensed RPM Venus swaps via URL.

const AVATAR_URL = 'https://raw.githubusercontent.com/met4citizen/TalkingHead/main/avatars/brunette.glb';
const DEG = Math.PI / 180;
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const _hairMV = new THREE.Matrix4(); // scratch for the hair object→view rotation
// scratch for aiming the eyes at the camera each frame
const _eyePos = new THREE.Vector3(), _eyeTgt = new THREE.Vector3(), _eyeDir = new THREE.Vector3();
const _eyeQ = new THREE.Quaternion();

// The 4 morph-rigged meshes that make up the visible face (verified from the GLB).
const FACE_NAMES = ['Wolf3D_Head', 'EyeLeft', 'EyeRight', 'Wolf3D_Teeth'];
// The bright glow SHELL is built from the face SKIN only — eyeballs + teeth stay
// on the dim substrate (cleaner sockets, no bright eye-blobs; structure leads).
const SHELL_NAMES = ['Wolf3D_Head'];
// Drop the outermost (ear) verts from the bright face shell (hidden under the bob).
const EAR_DROP_FRAC = 0.82;

// DEV: play a sample speech clip on load so the mouth moves (and the pulse reacts)
// on web. Set false for production / live Gemini audio. (Guarded to web.)
const DEV_LIPSYNC_TEST = false;
const DEV_SAMPLE_URL = 'https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg';

// Venus's lifecycle stages (drives the avatar; the Lab toggles between them, and Studio
// will map its flow onto these): pre-render = the dot/grid background before she forms;
// morphing = the dots assembling↔dispersing; silence = formed + listening (mouth at rest);
// talking = formed + lips moving (where Gemini audio drives the lip-sync).
export type VenusStage = 'pre-render' | 'morphing' | 'silence' | 'talking';


type Rig = {
  meshes: THREE.Mesh[];
  bones: { head?: THREE.Object3D; neck?: THREE.Object3D; leftEye?: THREE.Object3D; rightEye?: THREE.Object3D };
  rest: Map<THREE.Object3D, THREE.Euler>;
  latticeMat?: THREE.ShaderMaterial;     // THE unified field — ambient background + her face dots
  coreMat?: THREE.ShaderMaterial;
  edgeCoreMat?: THREE.LineBasicMaterial;
  edgeHaloMat?: THREE.LineBasicMaterial; // reveal fade
  occluderMat?: THREE.MeshBasicMaterial; // deforming dark face fill (shared by the mesh clones)
  skinMat?: THREE.MeshMatcapMaterial;    // shaded skin surface (baked living-hologram matcap)
  streamMat?: THREE.ShaderMaterial;      // persistent dot-field pulsing toward her
  eyeObjs: THREE.Object3D[];             // iris/sclera sprites — hidden until formed
  cycleMats: THREE.Material[]; // edges — narrow hue drift
  aura?: THREE.Object3D;       // billboarded aura pool
  shell?: THREE.Group;
  bob?: THREE.Mesh;            // procedural bob (per-frame hair-shader uniforms)
  hairMat?: THREE.ShaderMaterial;
  strandHairMat?: THREE.ShaderMaterial; // the flowing-bristle line layer
};






function Avatar({ url, stage = 'talking', onReveal }: { url: string; stage?: VenusStage; onReveal?: (r: number) => void }) {
  const { camera, gl } = useThree();
  const [root, setRoot] = useState<THREE.Object3D | null>(null);
  const rig = useRef<Rig | null>(null);
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;
  const a = useRef({
    nextBlink: 1.2, blinkAt: -1,
    nextSacc: 0.6, gx: 0, gy: 0,
    nextBrow: 2.5, browAt: -1, browAmt: 0,
    // gaze aversion (look AWAY while thinking/speaking, then back) + speech emphasis envelope
    nextAvert: 3, avertAt: -1, avDur: 1, avx: 0, avy: 0, aox: 0, aoy: 0,
    emph: 0,
  });

  // ── stage → reveal clock (0 = scattered dust, 1 = formed) + talking flag ───
  const reveal = useRef(0);          // eased value, driven in useFrame
  const revealTarget = useRef(stage === 'pre-render' ? 0 : 1);
  const talkingRef = useRef(stage === 'talking');
  useEffect(() => {
    talkingRef.current = stage === 'talking';
    if (stage === 'morphing') {
      // ping-pong the morph so we can watch dots↔face repeatedly
      revealTarget.current = reveal.current >= 0.5 ? 0 : 1;
      const id = setInterval(() => { revealTarget.current = revealTarget.current >= 0.5 ? 0 : 1; }, 4500);
      return () => clearInterval(id);
    }
    revealTarget.current = stage === 'pre-render' ? 0 : 1; // silence/talking = formed
  }, [stage]);
  // re-assemble from scratch when she (re)loads
  useEffect(() => { if (root) reveal.current = 0; }, [root]);

  // ── lip-sync driver (created once) ────────────────────────────────────────
  const lipRef = useRef<VenusLipsync | null>(null);
  const lipTargets = useRef<VisemeWeights>({});
  if (!lipRef.current) lipRef.current = createVenusLipsync();

  // DEV test harness: an <audio> element playing a sample speech clip (web only).
  useEffect(() => {
    if (!DEV_LIPSYNC_TEST || typeof Audio === 'undefined') return;
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.src = DEV_SAMPLE_URL;
    el.loop = true;
    const start = () => {
      lipRef.current?.resume();
      lipRef.current?.connect(el);
      el.play().catch((e) => console.warn('[venus] sample autoplay blocked; tap to start', e));
    };
    start();
    const onGesture = () => { start(); window.removeEventListener('pointerdown', onGesture); };
    if (typeof window !== 'undefined') window.addEventListener('pointerdown', onGesture);
    return () => {
      el.pause();
      el.src = '';
      if (typeof window !== 'undefined') window.removeEventListener('pointerdown', onGesture);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    // The remote GLB embeds its skin/face PNGs as data-URIs; native (Hermes) has no DOM image decoder,
    // so three can't decode them and logs `THREE.GLTFLoader: Couldn't load texture ...`. We DON'T use
    // the GLB's textures — we render the holographic wireframe + our own DataTextures and hide the
    // original meshes — so the geometry still loads fine. Silence ONLY those expected texture errors
    // (leave everything else intact) while the model loads.
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes("Couldn't load texture")) return;
      (origError as (...a: unknown[]) => void)(...args);
    };
    const restoreErr = () => { console.error = origError; };
    const restoreTimer = setTimeout(restoreErr, 20000); // fallback if onLoad never fires
    new GLTFLoader().load(
      url,
      (gltf) => {
        clearTimeout(restoreTimer);
        restoreErr();
        if (!alive) return;
        const isHair = (n: string) => /hair/i.test(n);
        const isClutter = (n: string) =>
          /hat|headwear|glasses|beard|outfit|shirt|body|hands|bottom|footwear/i.test(n);

        // ── classify + material each mesh ──────────────────────────────────
        // FACE substrate stays in the scene, DIM + additive + CONSTANT color so
        // the mouth still visibly lip-syncs under the bright shell.
        const meshes: THREE.Mesh[] = [];
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const n = m.name || '';
          if (isHair(n)) {
            m.visible = false; // long demo hair → hidden; we build a procedural bob
            return;
          }
          const isFace = FACE_NAMES.includes(n) || !!m.morphTargetDictionary;
          if (!isFace && isClutter(n)) {
            m.visible = false;
            return;
          }
          m.material = new THREE.MeshBasicMaterial({
            color: '#2C5C66',
            wireframe: true,
            transparent: true,
            opacity: 0.16, // carries the lip-sync — bright enough that the mouth visibly moves
            side: THREE.FrontSide, // cull the back of the skull → reads as a face, not an x-ray
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          if (m.morphTargetDictionary) meshes.push(m);
        });

        const get = (nm: string) => gltf.scene.getObjectByName(nm) ?? undefined;
        const bones = { head: get('Head'), neck: get('Neck'), leftEye: get('LeftEye'), rightEye: get('RightEye') };
        const rest = new Map<THREE.Object3D, THREE.Euler>();
        Object.values(bones).forEach((b) => b && rest.set(b, b.rotation.clone()));

        // ── frame the camera on the face FIRST — the cyclone grid bake needs the view
        //    extents. (Before the shell/aura are added; they'd inflate the bbox.) ──
        const cam = camera as THREE.PerspectiveCamera;
        const box = new THREE.Box3().setFromObject(gltf.scene);
        // Aim below the crown so the whole head has a little headroom (0.235 clipped the crown; 0.15
        // sat too low). ~0.18 keeps her high with the crown just inside the top; z pulls back for margin.
        const eyeY = box.max.y - 0.18;
        // z=1.04 frames her HEIGHT (tuned on web's wide aspect). A phone is tall/narrow, so the
        // horizontal extent shrinks and she'd be oversized/cropped — on PORTRAIT aspect, pull back far
        // enough to also fit her WIDTH. Wide aspect (web) keeps the original 1.04 framing exactly.
        const distH = 1.04;
        // On a tall/narrow (portrait/phone) screen the head fills the width and reads oversized; pull
        // the camera back proportionally to how narrow the aspect is. (Can't use the bbox width here —
        // it's the full body's shoulders, not the face.) Tuned visually at phone aspect (~0.46).
        const dist = cam.aspect < 1 ? distH * (1 + (1 - cam.aspect) * 0.9) : distH;
        cam.position.set(0, eyeY, dist);
        cam.lookAt(0, eyeY, 0);
        cam.updateProjectionMatrix();
        // half-extents of the view frustum at the head plane (head ≈ world z=0)
        const headDist = Math.abs(cam.position.z);
        const vH = Math.tan((cam.fov * DEG) / 2) * headDist;
        const vW = vH * cam.aspect;

        // ── build the glowing plexus shell ONCE (bind-pose; off the loop) ───
        const cycleMats: THREE.Material[] = [];
        const eyeObjs: THREE.Object3D[] = [];
        let shell: THREE.Group | undefined;
        let latticeMat: THREE.ShaderMaterial | undefined;
        let coreMat: THREE.ShaderMaterial | undefined;
        let edgeCoreMat: THREE.LineBasicMaterial | undefined;
        let edgeHaloMat: THREE.LineBasicMaterial | undefined;
        let occluderMat: THREE.MeshBasicMaterial | undefined; // shared dark fill (deforming clones)
        let skinMat: THREE.MeshMatcapMaterial | undefined;    // shaded skin surface (matcap)
        let streamMat: THREE.ShaderMaterial | undefined;
        let aura: THREE.Object3D | undefined;
        let bob: THREE.Mesh | undefined;
        let hairMat: THREE.ShaderMaterial | undefined;
        let strandHairMat: THREE.ShaderMaterial | undefined;
        let earClipX = 0; // |x| beyond which the dim substrate ears are clipped
        let headClipPlane: THREE.Plane | undefined; // WORLD-space plane: cut the skull above the hairline

        if (bones.head) {
          const dotTex = makeDotTexture();
          const irisTex = makeIrisTexture();
          const scleraTex = makeScleraTexture();
          const rawFace = bakeHeadLocal(gltf.scene, bones.head, SHELL_NAMES);
          if (rawFace) {
            rawFace.computeBoundingBox();
            const halfW = Math.max(Math.abs(rawFace.boundingBox!.min.x), Math.abs(rawFace.boundingBox!.max.x));
            earClipX = halfW * EAR_DROP_FRAC;
            // We don't want the whole rounded head above the bangs — only a little fibermesh. So the
            // BRIGHT shell (edges + lattice dots) stops a bit above the brows; above that is just the
            // faint substrate + the bangs. (HEAD-LOCAL geometry drop — NOT a world clip plane, which
            // shatters on a full-body avatar whose head sits at world y≈1.5.)
            bones.head.updateWorldMatrix(true, true);
            const crownLocalY = rawFace.boundingBox!.max.y;
            let eyeLineLocalY = (rawFace.boundingBox!.min.y + crownLocalY) / 2;
            if (bones.leftEye && bones.rightEye) {
              const le = new THREE.Vector3(), re = new THREE.Vector3();
              bones.leftEye.getWorldPosition(le); bones.rightEye.getWorldPosition(re);
              const mid = le.add(re).multiplyScalar(0.5);
              bones.head.worldToLocal(mid);
              eyeLineLocalY = mid.y;
            }
            const headTopY = eyeLineLocalY + 0.30 * (crownLocalY - eyeLineLocalY); // a little above the bangs
            const faceGeo = dropAbove(dropEars(rawFace, earClipX), headTopY); // bright shell: no skull above
            // the substrate skull (a SkinnedMesh we can't drop verts from) is cut by a WORLD-space plane
            // at the same head-local height — transformed via the head matrix so it cuts at the real
            // hairline (NOT at world y≈0, which is what shattered it before).
            headClipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), headTopY).applyMatrix4(bones.head.matrixWorld);
            bakeAurora(faceGeo);
            const faceDots = subsample(faceGeo, 3); // ~face vertices: position + aurora color + aY
            faceDots.computeBoundingBox();
            const fcHead = faceDots.boundingBox!.getCenter(new THREE.Vector3()); // head-local centroid
            const faceSize = faceDots.boundingBox!.getSize(new THREE.Vector3());

            // (a) THE UNIFIED LATTICE — ONE points buffer = ambient background + her face dots.
            //     Lives in its OWN scene-root group (world space): the FIXED camera looks down -Z,
            //     so the group is a screen-facing plane needing no per-frame billboard. Her dots
            //     PEEL UP from real background cells; the residual stays a living background pulsing
            //     toward her. (Shaders + Skia-look port: venus-points.ts.)
            const latticeGroup = new THREE.Group();
            gltf.scene.add(latticeGroup);
            bones.head.updateWorldMatrix(true, true);
            const headToGroup = latticeGroup.matrixWorld.clone().invert().multiply(bones.head.matrixWorld);
            const { geometry: latGeo, faceCentroid: fcGroup } = bakeUnifiedLattice(faceDots, { vW, vH }, headToGroup);
            latticeMat = new THREE.ShaderMaterial({
              uniforms: {
                uTime: { value: 0 }, uMorph: { value: 0 }, uReveal: { value: 0 },
                uPulse: { value: 0.12 }, uSpeak: { value: 0 }, uTalk: { value: 0 }, uBlip: { value: 1 },
                uSelA: { value: 0 }, uSelB: { value: 0 }, uFade: { value: 0 },
                uDrift: { value: new THREE.Vector2() }, uCellScale: { value: LAT_ROWS / 2.0 },
                uCenter: { value: fcGroup.clone() }, // funnel axis (group/world space)
                uSwirl: { value: 18.0 }, uUpdraft: { value: 0.72 }, uInfall: { value: 0.85 },
                uDot: { value: dotTex },
              },
              vertexShader: LATTICE_VERT,
              fragmentShader: LATTICE_FRAG,
              vertexColors: true,
              transparent: true,
              depthTest: true,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
            });
            const latticePts = new THREE.Points(latGeo, latticeMat);
            latticePts.renderOrder = 0;
            latticePts.frustumCulled = false; // dots move in-shader; never cull the whole field
            latticeGroup.add(latticePts);

            // (a2) the residual STREAM shell — the 3D volumetric depth-feed pulsing TOWARD her
            //      (the in-plane pulse is the lattice's job; this adds depth). Head-local.
            streamMat = new THREE.ShaderMaterial({
              uniforms: {
                uTime: { value: 0 }, uReveal: { value: 0 }, uCenter: { value: fcHead.clone() },
                uDot: { value: dotTex }, uFlow: { value: 0.15 }, uIntake: { value: 0.15 }, uSpeak: { value: 0 },
              },
              vertexShader: STREAM_VERT, fragmentShader: STREAM_FRAG,
              vertexColors: true, transparent: true, depthTest: true, depthWrite: false,
              blending: THREE.AdditiveBlending,
            });
            const streamPts = new THREE.Points(bakeStreamField(700, fcHead, faceSize), streamMat);
            streamPts.renderOrder = 1; // above occluder(-10), below shell(2)
            bones.head.add(streamPts);

            // (b) node halo is GONE — the lattice's LATTICE_FRAG inner-bloom (a += 0.4*a*a)
            //     replaces glowPts, one fewer Points draw.

            // (c) structural edges LEAD the look (+ scaled halo clone = fake thickness)
            const edgesGeo = new THREE.EdgesGeometry(faceGeo, 16);
            edgeCoreMat = new THREE.LineBasicMaterial({
              color: new THREE.Color('#3a6f8a'), transparent: true, opacity: 0, // reveal fades it in
              blending: THREE.AdditiveBlending, depthWrite: false,
            });
            const edgeCore = new THREE.LineSegments(edgesGeo, edgeCoreMat);
            edgeHaloMat = edgeCoreMat.clone();
            edgeHaloMat.opacity = 0;
            const edgeHalo = new THREE.LineSegments(edgesGeo, edgeHaloMat);
            edgeHalo.scale.setScalar(1.012);

            // (d) core glow — light from within (fresnel sphere behind the face; head-local centroid)
            coreMat = new THREE.ShaderMaterial({
              uniforms: { uColor: { value: new THREE.Color('#3FA6C8') }, uOpacity: { value: 0 } },
              vertexShader: CORE_VERT,
              fragmentShader: CORE_FRAG,
              transparent: true,
              depthTest: true,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
            });
            const coreSphere = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 2), coreMat);
            coreSphere.position.set(fcHead.x, fcHead.y, fcHead.z - 0.03);
            coreSphere.renderOrder = 0;

            shell = new THREE.Group();
            shell.add(coreSphere, edgeHalo, edgeCore); // back→front (nodes/halo now in the lattice)
            shell.renderOrder = 2;

            // (e) procedural BOB hair — a stylized shell (covers ears, fringe, A-line)
            //     rendered as a fresnel-glow volume. Sized off the crown + eye line.
            if (rawFace.boundingBox && bones.leftEye && bones.rightEye) {
              const e = new THREE.Vector3();
              const eR = new THREE.Vector3();
              bones.leftEye.getWorldPosition(e);
              bones.rightEye.getWorldPosition(eR);
              e.add(eR).multiplyScalar(0.5);
              bones.head.worldToLocal(e); // eye line in head-local space
              bob = buildBobHair(rawFace.boundingBox, e.y); // full bob — covers the crown (no cap)
              hairMat = bob.material as THREE.ShaderMaterial;
              // Render the hair BEFORE the head wireframe (it writes depth) so the scalp/forehead
              // BEHIND the hair is depth-culled — otherwise the translucent hair draws OVER the
              // head and you see her head through it. (occluder -10 < hair -5 < wireframe/lattice 0.)
              bob.renderOrder = -5;
              shell.add(bob);
              // flowing bristle strands OVER the shell (renderOrder -3: after the shell -5, additive
              // glow on top of the dense dark mass) so the hair reads as separate strands, not a block.
              const strands = buildHairStrands(rawFace.boundingBox, e.y);
              strandHairMat = strands.material as THREE.ShaderMaterial;
              strands.renderOrder = -3;
              shell.add(strands);
            }

            // (f) glowing irises — expressive gaze that tracks the saccades
            cycleMats.push(...makeIris(bones.leftEye, irisTex, scleraTex, dotTex, eyeObjs));
            cycleMats.push(...makeIris(bones.rightEye, irisTex, scleraTex, dotTex, eyeObjs));

            bones.head.add(shell);
            cycleMats.push(edgeCoreMat, edgeHaloMat);

            // solid dark FILL of the face + neck (the "blackness") — also the depth
            // (f) DEFORMING dark fill — the solid backing that stops BLEED-THROUGH. The wireframe is
            //   additive with depthWrite OFF, so with nothing solid behind it you see straight THROUGH
            //   to the interior/back mesh. The fill must DEFORM with the visemes (a STATIC fill stops
            //   matching the face the moment the jaw moves → the interior bleeds through). So we make a
            //   dark-fill DUPLICATE of each face mesh — sharing geometry + skeleton (via clone) + the
            //   morph-influence array — that writes depth just behind the front wireframe everywhere
            //   (even mouth-open), occluding the interior + background. DoubleSide so the open mouth
            //   shows dark interior, not the background. polygonOffset keeps the wireframe in front.
            occluderMat = new THREE.MeshBasicMaterial({
              color: new THREE.Color('#05090f'),
              transparent: true,
              opacity: 0, // reveal fades the dark fill in (depthWrite gated in useFrame)
              side: THREE.DoubleSide,
              polygonOffset: true,
              polygonOffsetFactor: 4,
              polygonOffsetUnits: 4, // small: just enough to keep the coincident wireframe in front
            });
            for (const src of meshes) {
              const occ = src.clone() as THREE.Mesh;       // clone() shares the skeleton for SkinnedMesh
              occ.material = occluderMat;
              occ.morphTargetInfluences = src.morphTargetInfluences; // SHARE → deforms with the wireframe
              occ.renderOrder = -10;
              (src.parent ?? bones.head).add(occ);
            }

            // (f2) SKIN — a real shaded surface so she reads as a finished head, not a bare wireframe.
            // A clone of the face skin (shares skeleton + the morph-influence array → deforms with the
            // visemes), shaded by a baked "living hologram" matcap (cyan form + warm subsurface at the
            // terminator + fresnel rim). Sits BETWEEN the dark occluder (-10) and the hair (-5); the
            // wireframe/edges/lattice glow OVER it. polygonOffset keeps it just behind the coincident wireframe.
            {
              const headSrc = meshes.find((m) => m.name === 'Wolf3D_Head') ?? meshes[0];
              if (headSrc) {
                skinMat = new THREE.MeshMatcapMaterial({
                  matcap: makeSkinMatcap(),
                  color: new THREE.Color('#9fe8f2'), // tints the matcap; lit-scaled per frame
                  transparent: true,
                  opacity: 0, // reveal fades it in
                  depthWrite: false, // gated true once she forms (useFrame)
                  polygonOffset: true,
                  polygonOffsetFactor: 2,
                  polygonOffsetUnits: 2,
                });
                const skin = headSrc.clone() as THREE.Mesh;
                skin.material = skinMat;
                skin.morphTargetInfluences = headSrc.morphTargetInfluences; // SHARE → deforms with visemes
                skin.renderOrder = -8;
                (headSrc.parent ?? bones.head).add(skin);
              }
            }

            // start the substrate hidden too — the reveal clock fades it in
            for (const m of meshes) (m.material as THREE.MeshBasicMaterial).opacity = 0;

            // (g) aura pool — she sits in her own light (billboarded, behind head)
            const auraMat = new THREE.MeshBasicMaterial({
              map: makeAuraTexture(), transparent: true, opacity: 0.1,
              blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
            });
            aura = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), auraMat);
            const hw = new THREE.Vector3();
            bones.head.getWorldPosition(hw);
            aura.position.set(hw.x, hw.y - 0.05, hw.z - 0.3);
            aura.scale.setScalar(0.95);
            aura.renderOrder = -1;
          }
        }

        rig.current = { meshes, bones, rest, latticeMat, coreMat, edgeCoreMat, edgeHaloMat, occluderMat, skinMat, eyeObjs, cycleMats, aura, shell, bob, hairMat, strandHairMat, streamMat };

        // clip the dim SUBSTRATE at the ear line so the ears don't poke out from under
        // the hair (the bright shell already dropped them; the bob covers the area).
        if (earClipX > 0) {
          gl.localClippingEnabled = true;
          const earPlanes = [
            new THREE.Plane(new THREE.Vector3(-1, 0, 0), earClipX), // keep x <= +earClipX
            new THREE.Plane(new THREE.Vector3(1, 0, 0), earClipX),  // keep x >= -earClipX
          ];
          // substrate also cut ABOVE the hairline (no bare skull above the hair). World-space plane.
          const subPlanes = headClipPlane ? [...earPlanes, headClipPlane] : earPlanes;
          for (const mm of meshes) {
            const mat = mm.material as THREE.Material;
            mat.clippingPlanes = subPlanes;
            mat.needsUpdate = true;
          }
          // ALSO clip the deforming dark FILL at the ears — otherwise it fills + depth-writes the
          // ears, punching them through the (translucent) hair. Now the hair covers the ear area.
          if (occluderMat) {
            occluderMat.clippingPlanes = earPlanes;
            occluderMat.needsUpdate = true;
          }
          // clip the SKIN like the substrate — ears + above the hairline — so no bare face shows past the hair
          if (skinMat) {
            skinMat.clippingPlanes = subPlanes;
            skinMat.needsUpdate = true;
          }
        }

        if (aura) gltf.scene.add(aura);
        setRoot(gltf.scene);
      },
      undefined,
      (e) => console.error('[venus] GLTF load error', e),
    );
    return () => {
      alive = false;
    };
  }, [url, camera]);

  useFrame((st, delta) => {
    const r = rig.current;
    if (!r) return;
    const t = st.clock.elapsedTime % 600; // modulo guard for mediump precision
    const s = a.current;
    const set = (name: string, v: number) => {
      for (const m of r.meshes) {
        const i = m.morphTargetDictionary?.[name];
        if (i !== undefined && m.morphTargetInfluences) m.morphTargetInfluences[i] = v;
      }
    };
    const sway = (b: THREE.Object3D | undefined, x: number, y: number, z: number) => {
      if (!b) return;
      const rr = r.rest.get(b)!;
      b.rotation.set(rr.x + x, rr.y + y, rr.z + z);
    };

    // ── reveal clock (0 = scattered dust-cloud → 1 = fully her; faster disperse) ──
    const inbound = revealTarget.current > reveal.current;
    reveal.current = THREE.MathUtils.damp(reveal.current, revealTarget.current, inbound ? 3.0 : 4.5, delta);
    const R = reveal.current;
    onRevealRef.current?.(R); // report progress so the parent can crossfade the app background
    const seg = (lo: number, hi: number) => { const x = THREE.MathUtils.clamp((R - lo) / (hi - lo), 0, 1); return x * x * (3 - 2 * x); };
    const alive = R > 0.6; // gate the human micro-life until she's formed

    // ── narrow hue drift (cyan→violet arc, ±14°, ~28s) — EDGES + hair only ──
    const h = 0.52 + 0.04 * Math.sin(t * 0.045);
    for (const m of r.cycleMats) (m as THREE.LineBasicMaterial).color?.setHSL(h, 0.5, 0.55);

    // ── rare holographic blip (the ONE instability) ────────────────────────
    const blip = Math.random() < 0.003 ? 0.82 : 1.0;

    // ── THE UNIFIED LATTICE: ambient Skia-look background + her face dots peeling up ──
    const speak = lipTargets.current.jawOpen ?? 0;
    if (r.latticeMat) {
      const u = r.latticeMat.uniforms;
      const { selA, selB, fade } = motionSelect(t); // Skia 12s pattern crossfade (JS-side)
      u.uTime.value = t;
      u.uBlip.value = blip;
      u.uReveal.value = R;
      u.uMorph.value = seg(0.1, 0.62);      // the cyclone window — her dots peel + gather + snap
      u.uSelA.value = selA; u.uSelB.value = selB; u.uFade.value = fade;
      (u.uDrift.value as THREE.Vector2).set(t * 0.010, t * 0.006); // Skia parallax (pattern only)
      u.uSpeak.value = THREE.MathUtils.damp(u.uSpeak.value, speak * 1.2, 8, delta);
      u.uTalk.value = THREE.MathUtils.damp(u.uTalk.value, talkingRef.current ? 1 : 0, 5, delta); // speech pulse gate
      // residual inward-pulse: gentle breath at rest → ramps with the morph → eases to ~0.5 formed
      const pulseTarget = 0.12 + 0.88 * seg(0.18, 0.5) * (1 - 0.5 * seg(0.7, 0.95)) + 0.5 * seg(0.7, 0.95);
      u.uPulse.value = THREE.MathUtils.damp(u.uPulse.value, pulseTarget, 3, delta);
    }

    // ── persistent stream field: heavy intake during the morph, quiet feed once formed ──
    if (r.streamMat) {
      const u = r.streamMat.uniforms;
      u.uTime.value = t;
      u.uReveal.value = R;
      const baseFlow = 0.15 + 0.85 * seg(0.1, 0.5);
      const settle = 0.55 * seg(0.66, 0.92);
      u.uFlow.value = THREE.MathUtils.damp(u.uFlow.value, baseFlow - settle, 3, delta);
      const intake = 0.15 + 1.0 * seg(0.18, 0.5) * (1 - seg(0.55, 0.85));
      u.uIntake.value = THREE.MathUtils.damp(u.uIntake.value, intake, 3.5, delta);
      u.uSpeak.value = THREE.MathUtils.damp(u.uSpeak.value, speak * 1.0, 6, delta);
    }

    // ── structure layers fade in AFTER the face dots land (the choreography) ────
    // Silent and talking sit at a SIMILAR brightness — just a little brighter when SPEAKING.
    // `lit`: silent 0.88, talking ~1.0 (+ a touch on jawOpen).
    const talk = talkingRef.current ? 1 : 0;
    const lit = 0.88 + 0.12 * talk + 0.06 * speak * talk;
    if (r.edgeCoreMat) r.edgeCoreMat.opacity = 0.40 * lit * seg(0.62, 0.78) * blip;
    if (r.edgeHaloMat) r.edgeHaloMat.opacity = 0.12 * lit * seg(0.62, 0.78);
    const subA = 0.32 * lit * seg(0.62, 0.78);
    for (const m of r.meshes) (m.material as THREE.MeshBasicMaterial).opacity = subA;
    if (r.coreMat) r.coreMat.uniforms.uOpacity.value = (0.5 + 0.1 * Math.sin(t * 0.5)) * seg(0.6, 0.8);
    if (r.occluderMat) {
      const om = r.occluderMat;
      om.opacity = seg(0.5, 0.66);
      om.depthWrite = R > 0.5; // only occlude once the face forms (else it clips the cloud)
      // FULL BLUE fill — the consistent base colour of the whole head. A dim teal lift left the smooth
      // cheek/jaw reading dark vs the neck; a solid blue tint (the red-diagnostic showed the fill covers
      // the whole face+neck) makes the entire head one cohesive colour. Scaled by `lit` (a touch
      // brighter speaking).
      om.color.setRGB(0.05 * lit, 0.21 * lit, 0.46 * lit);
    }
    // SKIN fades in WITH the structure (slightly translucent → reads as a luminous holographic surface,
    // not opaque plastic); depthWrite gates on once formed; a subtle brighten while she speaks.
    if (r.skinMat) {
      const sm = r.skinMat;
      sm.opacity = 0.92 * seg(0.55, 0.78);
      sm.depthWrite = R > 0.5;
      const sk = 0.84 + 0.16 * talk + 0.05 * speak * talk;
      sm.color.setRGB(0.62 * sk, 0.91 * sk, 0.95 * sk);
    }
    // Hair fades in WITH the face structure (edges/substrate at 0.62–0.78), not after it — so during
    // the morph everything loads together instead of the hair popping in last.
    if (r.bob) r.bob.scale.setScalar(THREE.MathUtils.lerp(0.92, 1, seg(0.55, 0.76)));
    if (r.hairMat) r.hairMat.uniforms.uFade.value = seg(0.55, 0.76); // whole hair (rim incl.) fades in
    if (r.strandHairMat) {
      r.strandHairMat.uniforms.uTime.value = t;
      r.strandHairMat.uniforms.uFade.value = seg(0.55, 0.76); // bristles fade in with the shell
    }
    // ── eyes look AT the user (camera) with a gentle saccade drift (not a fixed stare) ──
    for (const eye of r.eyeObjs) {
      eye.visible = R > 0.66; // appear once she's formed (no floating eyes mid-cloud)
      const eb = eye.parent;
      if (!eb) continue;
      eb.getWorldPosition(_eyePos);
      // gaze = the user (camera) + a small fixational drift + an occasional larger AVERSION (look away,
      // then back). Without the aversion she reads as a fixed stare; the aversion is the "alive" tell.
      _eyeTgt.copy(camera.position).add(_eyeDir.set(s.gx * 0.06 + s.aox, s.gy * 0.045 + s.aoy, 0));
      _eyeDir.copy(_eyeTgt).sub(_eyePos).normalize();   // world-space gaze direction
      eb.getWorldQuaternion(_eyeQ).invert();
      _eyeDir.applyQuaternion(_eyeQ);                    // into the eye-bone local frame
      eye.position.copy(_eyeDir).multiplyScalar(EYE_R);  // iris on the eyeball, facing the user
    }

    // ── shell parallax + aura billboard/breath (aura blooms in last) ────────
    if (r.shell) {
      r.shell.rotation.y = Math.sin(t * 0.18) * 0.05;
      r.shell.position.y = Math.sin(t * 0.5) * 0.003;
    }
    if (r.aura) {
      const aA = seg(0.85, 1);
      ((r.aura as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.1 * aA;
      r.aura.quaternion.copy(camera.quaternion);
      r.aura.scale.setScalar(THREE.MathUtils.lerp(0.7, 0.95, aA) * (1 + 0.03 * Math.sin(t * 0.25)));
    }

    // ── hair: object→view rotation (anisotropic sheen band) + time + breathing light ──
    if (r.bob && r.hairMat) {
      r.bob.updateWorldMatrix(true, false);
      _hairMV.multiplyMatrices(camera.matrixWorldInverse, r.bob.matrixWorld);
      r.hairMat.uniforms.uViewRot.value.setFromMatrix4(_hairMV);
      r.hairMat.uniforms.uTime.value = t;
      r.hairMat.uniforms.uLightVS.value
        .set(0.15, 0.55, 0.85)
        .applyAxisAngle(Z_AXIS, Math.sin(t * 0.6) * 0.06)
        .normalize();
    }

    if (alive) {
    // Is she speaking right now (stage OR real audio still playing out)? Her eye life intensifies on
    // speech — busier saccades, more gaze aversion, brows engaged — which is what was missing.
    const speaking = talkingRef.current || (lipRef.current?.speaking?.() ?? false);
    const ss01 = (x: number) => { const c = x < 0 ? 0 : x > 1 ? 1 : x; return c * c * (3 - 2 * c); };

    // blink — eyelids close + open (0→1→0). A little MORE OFTEN while speaking.
    if (s.blinkAt < 0 && t > s.nextBlink) s.blinkAt = t;
    let blink = 0;
    if (s.blinkAt >= 0) {
      const p = (t - s.blinkAt) / 0.14;
      if (p >= 1) {
        s.blinkAt = -1;
        s.nextBlink = t + (speaking ? 1.4 : 2) + Math.random() * (speaking ? 2.6 : 3.5);
      } else blink = Math.sin(p * Math.PI);
    }
    set('eyeBlinkLeft', blink);
    set('eyeBlinkRight', blink);

    // idle head + neck sway (from rest, mixed slow sines)
    sway(r.bones.head, Math.sin(t * 0.7) * 2 * DEG, Math.sin(t * 0.53) * 2.4 * DEG, Math.sin(t * 0.37) * 1 * DEG);
    sway(r.bones.neck, Math.sin(t * 0.7) * 1 * DEG, Math.sin(t * 0.53) * 1.2 * DEG, 0);

    // eye saccades — small fixational darts; a touch bigger + more frequent while speaking (busier eyes).
    if (t > s.nextSacc) {
      const g = speaking ? 1.25 : 1;
      s.gx = (Math.random() - 0.5) * 2 * g;
      s.gy = (Math.random() - 0.5) * 1.2 * g;
      s.nextSacc = t + (speaking ? 0.18 : 0.32) + Math.random() * (speaking ? 0.5 : 0.9);
    }

    // GAZE AVERSION — every few seconds she glances AWAY (slightly up + to a side, the natural
    // "thinking/recalling" beat), holds, then returns to the user. More frequent while speaking. This
    // is the single biggest "alive, not staring" cue — added on TOP of the camera-aim above (s.aox/aoy).
    if (s.avertAt < 0 && t > s.nextAvert) {
      s.avertAt = t;
      s.avDur = (speaking ? 0.7 : 0.9) + Math.random() * (speaking ? 1.0 : 0.7); // ramp-in + hold + ramp-out
      const side = Math.random() < 0.5 ? -1 : 1;
      s.avx = side * (0.08 + Math.random() * (speaking ? 0.1 : 0.06)); // sideways glance (≤ ~0.18)
      s.avy = 0.04 + Math.random() * 0.1;                              // slight upward (recall)
    }
    if (s.avertAt >= 0) {
      const p = (t - s.avertAt) / s.avDur;
      if (p >= 1) {
        s.avertAt = -1; s.aox = 0; s.aoy = 0;
        s.nextAvert = t + (speaking ? 1.6 : 4) + Math.random() * (speaking ? 3 : 5);
      } else {
        const env = p < 0.22 ? ss01(p / 0.22) : p > 0.78 ? ss01((1 - p) / 0.22) : 1; // ease in → hold → ease out
        s.aox = s.avx * env;
        s.aoy = s.avy * env;
      }
    }

    // brow: faint baseline + random micro-flashes + a gentle lift that TRACKS HER VOICE. The voice term
    // is a slow (~0.4s) envelope of speech energy, NOT per-syllable jaw, so the brows engage while she
    // talks and settle when quiet — never an uncanny per-vowel bounce.
    s.emph += ((speaking ? Math.min(1, speak * 1.5) : 0) - s.emph) * (1 - Math.exp(-delta / 0.4));
    if (s.browAt < 0 && t > s.nextBrow) {
      s.browAt = t;
      s.browAmt = 0.15 + Math.random() * 0.2;
    }
    let brow = 0.04;
    if (s.browAt >= 0) {
      const p = (t - s.browAt) / 0.7;
      if (p >= 1) {
        s.browAt = -1;
        s.nextBrow = t + (speaking ? 2 : 3) + Math.random() * 5;
      } else brow = 0.04 + s.browAmt * Math.sin(p * Math.PI);
    }
    const browSpeak = s.emph * 0.1;
    set('browInnerUp', brow + browSpeak);
    set('browOuterUpLeft', browSpeak * 0.8);
    set('browOuterUpRight', browSpeak * 0.8);

    // faint resting smile (Mona-Lisa level)
    set('mouthSmileLeft', 0.1);
    set('mouthSmileRight', 0.1);

    // ── lip-sync (owns ONLY jaw/mouth/viseme morphs) — only when TALKING; else rest closed ──
    const lip = lipRef.current;
    if (lip) {
      // Real spoken audio (native Gemini PCM) keeps driving the mouth even after the turn "completes"
      // — chunks buffer ahead, so her queued audio finishes playing AFTER the state flips to silence.
      const realAudio = lip.speaking?.() ?? false;
      const talking = talkingRef.current || realAudio;
      const targets: VisemeWeights = talking ? lip.sample() : {};
      // DEV fallback: when talking but there's NO real audio source (the Lab, or a CORS-blocked web
      // test clip), drive a gentle SYNTHETIC "talk" so she moves. Never run it OVER real audio —
      // that's what would desync her, and it'd flap during the real silences between words.
      if (talkingRef.current && !realAudio && DEV_LIPSYNC_TEST && (lip.debug?.rms ?? 0) < 0.008) {
        const env = 0.55 + 0.45 * Math.sin(t * 1.7);              // syllable envelope
        const o = Math.max(0, Math.sin(t * 6.5)) * env;           // mouth opens in bursts
        targets.viseme_sil = 0;
        targets.jawOpen = o * 0.9;
        targets.mouthOpen = o * 0.55;
        targets.viseme_aa = o * (0.6 + 0.4 * Math.sin(t * 3.1));
        targets.viseme_O = (1 - o) * 0.4;
        targets.viseme_E = o * 0.4 * (0.5 + 0.5 * Math.sin(t * 5.3));
      }
      lipTargets.current = targets;
      for (const name of LIPSYNC_MORPHS) {
        for (const m of r.meshes) {
          const i = m.morphTargetDictionary?.[name];
          if (i === undefined || !m.morphTargetInfluences) continue;
          const target = targets[name] ?? 0;
          const cur = m.morphTargetInfluences[i];
          const isJaw = name === 'jawOpen' || name === 'mouthOpen' || name === 'mouthClose';
          // Asymmetric attack/decay: a FAST ATTACK (opening) keeps consonants crisp, a SLOWER DECAY
          // (closing) stops vowels buzzing. Jaw is a touch slower than the lip shapes.
          const opening = target > cur;
          const lambda = isJaw ? (opening ? 18 : 12) : (opening ? 16 : 10);
          m.morphTargetInfluences[i] = THREE.MathUtils.damp(cur, target, lambda, delta);
        }
      }
    }
    } // end if (alive) — the human micro-life only runs once she's formed
  });

  return root ? <primitive object={root} /> : null;
}

// `stage` drives her lifecycle (pre-render → morphing → silence → talking). The Lab toggles
// it; Studio will map its flow onto these (e.g. 'morphing' on brand-create, 'talking' when
// Venus speaks, 'silence' when listening).
export default function VenusHeadScene({ stage = 'talking', onReveal }: { stage?: VenusStage; onReveal?: (r: number) => void }) {
  // TRANSPARENT canvas (no opaque background) so the app's dot-field can show THROUGH
  // behind her — the pre-render background that she morphs out of. `onReveal` reports the
  // assembly progress each frame so the parent can crossfade that background.
  return (
    <Canvas camera={{ position: [0, 0, 2], fov: 22 }} style={{ flex: 1 }} gl={{ alpha: true }}>
      <Avatar url={AVATAR_URL} stage={stage} onReveal={onReveal} />
    </Canvas>
  );
}
