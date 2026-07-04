import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { createVenusLipsync, type VenusLipsync, type VisemeWeights } from '@/lib/venus-lipsync';
import { LATTICE_VERT, LATTICE_FRAG, motionSelect } from './venus-points';
import { CORE_VERT, CORE_FRAG, STREAM_VERT, STREAM_FRAG } from './venus-shaders';
import { makeAuraTexture, makeDotTexture } from './venus-textures';
import { bakeAurora, bakeStreamField, bakeUnifiedLattice, LAT_ROWS } from './venus-geometry';
import {
  PLASMA_VERT, PLASMA_FRAG, INNER_FRAG, VEIL_VERT, VEIL_FRAG,
  NET_VERT, NET_FRAG, NODE_VERT, NODE_FRAG,
} from './venus-plasma';
import { getVenusOrbShapeRequest, setVenusOrbShape, type VenusOrbShape } from './venus-orb-bus';
import type { VenusStage } from './venus-head-scene';

// ── Venus ORB v2 — the "CONTAINED STAR" (R3F) ───────────────────────────────
// Venus as a JARVIS-style brain: a contained miniature star. The app's dot-field background
// still peels up and cyclones into her (the SAME unified lattice + morph as the face build) —
// but what ignites underneath is now a churning PHOTOSPHERE: a displaced sphere running
// domain-warped 3D fbm in differentially-rotating spherical coords (the equator spins faster
// than the poles, like a real star), navy troughs → cyan flow → platinum crests, a white-hot
// heart through inverse-fresnel, Eddington limb darkening, and a razor platinum rim. A BackSide
// interior pass counter-rotates behind the surface so you can see INTO the volume (parallax),
// two gauze veils replace the old wireframe cage, and a 3-sprite halo stack fakes bloom (no
// postprocessing). Idle = slow convection + ±0.8% breath; talking = the surface BOILS, the
// heart flares on syllables, the thought-pulse band sweeps bottom→top in the SAME clock as the
// lattice dot wave, and the room halo pulses with her voice.
// Full spec + tuning knobs: docs/studio/VENUS_AVATAR.md (orb v2). Shaders: venus-plasma.ts.
//
// Same public shape as VenusHeadScene ({ stage, onReveal }); the Cortana face build stays
// available behind the Lab's Face toggle.

const ORB_R = 0.26; // orb radius — camera at z=2 / fov 22 gives ~0.39 half-height at the origin
const ORB_DOTS = 880; // lattice dots that peel from the background onto the sphere (face used ~900)
const CYAN = '#5BD8E6';
const PLATINUM = '#cdd1d9';
const NAVY = '#0B1626';
const KEY_VS = new THREE.Vector3(-0.4, 0.55, 0.73); // key light (view-space) — matches makeSkinMatcap's key
const FILL_VS = new THREE.Vector3(0.55, -0.4, 0.6); // faint lower-right counter-glint

// THE RADIUS LADDER (load-bearing): body sphere 0.88·ORB_R with uAmp clamped ≤ 0.12 → displaced
// crests ≤ 0.986·ORB_R < 1.00·ORB_R (the lattice dot skin — dots read as sparks floating just
// above the photosphere and the morph landing stays correct) < 1.045·ORB_R veilA (platinum)
// < 1.10·ORB_R veilB (cyan). Raising uAmp past 0.12 or the body past 0.88 swallows the dots.
const BODY_R = ORB_R * 0.88;

// Even sphere-surface points (fibonacci lattice) with the aurora bake (constant cyan color +
// normalized height aY — which is exactly what drives the talking light wave — + per-dot random).
function bakeOrbDots(count: number, radius: number): THREE.BufferGeometry {
  const pos = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * i;
    pos[i * 3] = Math.cos(th) * r * radius;
    pos[i * 3 + 1] = y * radius;
    pos[i * 3 + 2] = Math.sin(th) * r * radius;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  bakeAurora(g);
  return g;
}

// ── SHAPE MORPH: 2D object silhouettes the dots can re-form into ────────────
// Flat point clouds facing the fixed camera read crisply. Each sampler rejection-fills a unit
// silhouette, scaled to ~1.3R with a little z-jitter for depth sparkle.
function pointInPoly(x: number, y: number, poly: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const TEE_POLY = [
  [-0.95, 0.5], [-0.55, 0.72], [-0.18, 0.6], [0, 0.52], [0.18, 0.6], [0.55, 0.72], [0.95, 0.5],
  [0.68, 0.12], [0.45, 0.24], [0.45, -0.78], [-0.45, -0.78], [-0.45, 0.24], [-0.68, 0.12],
];
const BOLT_POLY = [
  [0.12, 1.0], [-0.5, 0.05], [-0.08, 0.05], [-0.34, -1.0], [0.5, 0.12], [0.06, 0.12],
];
function insideShape(name: VenusOrbShape, x: number, y: number): boolean {
  if (name === 'tee') return pointInPoly(x, y, TEE_POLY);
  if (name === 'bolt') return pointInPoly(x, y, BOLT_POLY);
  if (name === 'heart') {
    const yy = y * 1.2 - 0.1;
    const a = x * x + yy * yy - 1;
    return a * a * a - x * x * yy * yy * yy <= 0;
  }
  return x * x + y * y <= 1;
}
function sampleShape(name: VenusOrbShape, count: number, R: number): Float32Array {
  const out = new Float32Array(count * 3);
  // ~orb-sized: unit shapes span ±1, so S=R keeps the object inside the old silhouette and the
  // dot density high enough to read (at 1.3R the tee filled the whole canvas and read as dust).
  const S = R;
  let i = 0, guard = 0;
  while (i < count && guard < count * 400) {
    guard++;
    const x = Math.random() * 2.6 - 1.3;
    const y = Math.random() * 2.6 - 1.3;
    if (!insideShape(name, x, y)) continue;
    out[i * 3] = x * S;
    out[i * 3 + 1] = y * S;
    out[i * 3 + 2] = (Math.random() - 0.5) * R * 0.12;
    i++;
  }
  return out;
}

type OrbRig = {
  latticeMat: THREE.ShaderMaterial;
  streamMat: THREE.ShaderMaterial;
  bodyMat: THREE.ShaderMaterial;
  innerMat: THREE.ShaderMaterial;
  nucleusMat: THREE.ShaderMaterial;
  netMat: THREE.ShaderMaterial;
  nodeMat: THREE.ShaderMaterial;
  netGroup: THREE.Group;
  veilAMat: THREE.ShaderMaterial;
  veilBMat: THREE.ShaderMaterial;
  veilA: THREE.Mesh;
  veilB: THREE.Mesh;
  haloTightMat: THREE.MeshBasicMaterial;
  haloMidMat: THREE.MeshBasicMaterial;
  haloWideMat: THREE.MeshBasicMaterial;
  orbGroup: THREE.Group;
};

// Bake the NEURON NETWORK once: nodes fill the shell between the nucleus and the membrane
// (biased outward so the middle stays airy), each wired to its nearest neighbours, and a share
// of nodes get a SPOKE down toward the nucleus so the whole web reads as rooted at the centre.
// Returns LineSegments geometry (synapses: per-vertex aT 0→1 + per-edge phase) and Points
// geometry (neurons: per-node phase + size, hubs bigger).
function bakeNeuralNet(count: number, R: number): { lines: THREE.BufferGeometry; nodes: THREE.BufferGeometry } {
  const pos: number[] = [];
  for (let i = 0; i < count; i++) {
    // uniform direction, radius biased outward between 0.30R (nucleus clearance) and 0.80R
    const u = Math.random() * 2 - 1;
    const ph = Math.random() * Math.PI * 2;
    const sxy = Math.sqrt(Math.max(0, 1 - u * u));
    const r = R * (0.3 + 0.5 * Math.cbrt(Math.random()));
    pos.push(sxy * Math.cos(ph) * r, u * r, sxy * Math.sin(ph) * r);
  }
  const p = (i: number) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  // wire each node to its 2 nearest neighbours (deduped), max reach 0.55R
  const edges: [number, number][] = [];
  const seen = new Set<string>();
  const degree = new Array(count).fill(0);
  for (let i = 0; i < count; i++) {
    const a = p(i);
    const near = Array.from({ length: count }, (_, j) => j)
      .filter((j) => j !== i)
      .map((j) => ({ j, d: a.distanceTo(p(j)) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, 2)
      .filter((x) => x.d < R * 0.55);
    for (const { j } of near) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([i, j]);
        degree[i]++; degree[j]++;
      }
    }
  }
  // spokes: ~30% of nodes also connect inward to the nucleus surface
  const spokeEnds: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    if (i % 3 === 0) {
      const a = p(i);
      spokeEnds.push(a.clone().setLength(R * 0.24));
      edges.push([i, count + spokeEnds.length - 1]);
    }
  }
  const at = (i: number) => (i < count ? p(i) : spokeEnds[i - count]);
  // synapse lines: 2 verts per edge, aT 0→1, shared per-edge phase
  const lp: number[] = [], lt: number[] = [], lph: number[] = [];
  for (const [i, j] of edges) {
    const a = at(i), b = at(j);
    const phase = Math.random();
    lp.push(a.x, a.y, a.z, b.x, b.y, b.z);
    lt.push(0, 1);
    lph.push(phase, phase);
  }
  const lines = new THREE.BufferGeometry();
  lines.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lp), 3));
  lines.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(lt), 1));
  lines.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(lph), 1));
  // neuron points: hubs (degree ≥ 3) render bigger
  const nph = new Float32Array(count), nsz = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    nph[i] = Math.random();
    nsz[i] = degree[i] >= 3 ? 30 : 18;
  }
  const nodes = new THREE.BufferGeometry();
  nodes.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  nodes.setAttribute('aPhase', new THREE.BufferAttribute(nph, 1));
  nodes.setAttribute('aSize', new THREE.BufferAttribute(nsz, 1));
  return { lines, nodes };
}

function Orb({ stage = 'talking', onReveal }: { stage?: VenusStage; onReveal?: (r: number) => void }) {
  const { camera, advance } = useThree();
  const [root, setRoot] = useState<THREE.Object3D | null>(null);

  // __DEV__ Lab hook (like the face scene's __venusRevealOverride): step simulated time from the
  // console — `__venusOrbStep(tSeconds)` advances one frame. Hidden/automated tabs get no rAF, so
  // this is how stills are captured deterministically (see VENUS_AVATAR.md "judge the morph live").
  useEffect(() => {
    if (!__DEV__) return;
    (globalThis as { __venusOrbStep?: (ts: number) => void }).__venusOrbStep = (ts: number) => advance(ts);
    return () => {
      delete (globalThis as { __venusOrbStep?: (ts: number) => void }).__venusOrbStep;
    };
  }, [advance]);
  const rig = useRef<OrbRig | null>(null);
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;

  // ── stage → reveal clock (0 = scattered dust, 1 = formed star) + talking flag ──
  const reveal = useRef(0);
  const revealTarget = useRef(stage === 'pre-render' ? 0 : 1);
  const talkingRef = useRef(stage === 'talking');
  useEffect(() => {
    talkingRef.current = stage === 'talking';
    if (stage === 'morphing') {
      revealTarget.current = reveal.current >= 0.5 ? 0 : 1;
      const id = setInterval(() => { revealTarget.current = revealTarget.current >= 0.5 ? 0 : 1; }, 4500);
      return () => clearInterval(id);
    }
    revealTarget.current = stage === 'pre-render' ? 0 : 1;
  }, [stage]);
  useEffect(() => { if (root) reveal.current = 0; }, [root]);

  // Speech drive: the SAME lip-sync pipeline as the face — but jawOpen energy lights the star
  // instead of moving a mouth. (Web: AnalyserDriver; native: the formant SpeechLevelDriver.)
  const lipRef = useRef<VenusLipsync | null>(null);
  if (!lipRef.current) lipRef.current = createVenusLipsync();
  const lipTargets = useRef<VisemeWeights>({});

  // SHAPE-MORPH state: bus requests are polled per frame; a transition dissolves the dots
  // (reveal dips), swaps their targets to the new silhouette, then re-forms. shapeGate dims the
  // sphere-shaped layers (membrane/net/nucleus/veils) while a non-orb object is showing.
  const shapeRig = useRef<{ latGeo: THREE.BufferGeometry; idx: number[]; orbTargets: Float32Array; orbFaceY: Float32Array } | null>(null);
  const shapeState = useRef({ seq: 0, showing: 'orb' as VenusOrbShape, pending: null as VenusOrbShape | null, gate: 0 });
  useEffect(() => {
    if (!__DEV__) return;
    const g = globalThis as {
      __venusOrbShape?: (s: VenusOrbShape) => void;
      __venusOrbDebug?: () => unknown;
    };
    g.__venusOrbShape = (s) => setVenusOrbShape(s);
    // Dev-only introspection for the deterministic-stills workflow: the live shape-machine state
    // plus the bounding box of the face dots' CURRENT landing targets (sphere ≈ cube ±R; a flat
    // object ≈ thin z). See docs/studio/VENUS_AVATAR.md.
    g.__venusOrbDebug = () => {
      const sr = shapeRig.current;
      let box: number[] | null = null;
      if (sr) {
        const tgt = sr.latGeo.getAttribute('aTarget') as THREE.BufferAttribute;
        let nx = 1e9, px = -1e9, ny = 1e9, py = -1e9, nz = 1e9, pz = -1e9;
        for (const li of sr.idx) {
          const x = tgt.getX(li), y = tgt.getY(li), z = tgt.getZ(li);
          nx = Math.min(nx, x); px = Math.max(px, x);
          ny = Math.min(ny, y); py = Math.max(py, y);
          nz = Math.min(nz, z); pz = Math.max(pz, z);
        }
        box = [nx, px, ny, py, nz, pz].map((v) => Math.round(v * 1000) / 1000);
      }
      return { ...shapeState.current, reveal: reveal.current, revealTarget: revealTarget.current, rig: !!sr, box };
    };
    return () => {
      delete g.__venusOrbShape;
      delete g.__venusOrbDebug;
    };
  }, []);

  // ── build once (synchronous — no GLB to load) ───────────────────────────────
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.position.set(0, 0, 2);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    const vH = Math.tan((cam.fov * Math.PI) / 360) * 2; // half-height of the view at the orb plane
    const vW = vH * cam.aspect;

    const scene = new THREE.Group();
    const dotTex = makeDotTexture();
    const auraTex = makeAuraTexture();

    // (a) THE UNIFIED LATTICE — ambient background dots + the orb's dot skin in ONE buffer.
    //     Identity transform: the orb lives at the world origin, so target points are world-space.
    const orbDots = bakeOrbDots(ORB_DOTS, ORB_R);
    const { geometry: latGeo, faceCentroid } = bakeUnifiedLattice(orbDots, { vW, vH }, new THREE.Matrix4());
    const latticeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uMorph: { value: 0 }, uReveal: { value: 0 }, uLead: { value: 0 },
        uPulse: { value: 0.12 }, uSpeak: { value: 0 }, uTalk: { value: 0 }, uBlip: { value: 1 },
        uSelA: { value: 0 }, uSelB: { value: 0 }, uFade: { value: 0 },
        uDrift: { value: new THREE.Vector2() }, uCellScale: { value: LAT_ROWS / 2.0 },
        uCenter: { value: faceCentroid.clone() },
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
    latticePts.frustumCulled = false;
    scene.add(latticePts);

    // SHAPE-MORPH rig: remember which lattice dots are hers (aIsFace) and their sphere landing
    // spots, so setVenusOrbShape() can retarget them to an object silhouette and back.
    {
      const isFace = latGeo.getAttribute('aIsFace');
      const tgt = latGeo.getAttribute('aTarget');
      const fy = latGeo.getAttribute('aFaceY');
      const idx: number[] = [];
      for (let i = 0; i < isFace.count; i++) if (isFace.getX(i) > 0.5) idx.push(i);
      const orbTargets = new Float32Array(idx.length * 3);
      const orbFaceY = new Float32Array(idx.length);
      idx.forEach((li, k) => {
        orbTargets[k * 3] = tgt.getX(li);
        orbTargets[k * 3 + 1] = tgt.getY(li);
        orbTargets[k * 3 + 2] = tgt.getZ(li);
        orbFaceY[k] = fy.getX(li);
      });
      shapeRig.current = { latGeo, idx, orbTargets, orbFaceY };
    }

    // (b) the stream field — a volumetric shell of dots looping INTO the star (the depth-feed).
    const streamMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uReveal: { value: 0 }, uCenter: { value: new THREE.Vector3(0, 0, 0) },
        uDot: { value: dotTex }, uFlow: { value: 0.15 }, uIntake: { value: 0.15 }, uSpeak: { value: 0 },
      },
      vertexShader: STREAM_VERT,
      fragmentShader: STREAM_FRAG,
      vertexColors: true, transparent: true, depthTest: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const streamPts = new THREE.Points(
      bakeStreamField(600, new THREE.Vector3(0, 0, 0), new THREE.Vector3(ORB_R, ORB_R, ORB_R)),
      streamMat,
    );
    streamPts.renderOrder = 1;
    scene.add(streamPts);

    // (c) the star body. The camera is FIXED at +z, so static planes inside orbGroup ARE
    //     billboards — the 3-sprite halo stack is the fake bloom (no postprocessing).
    const orbGroup = new THREE.Group();

    const haloMat = (map: THREE.Texture, color?: string) =>
      new THREE.MeshBasicMaterial({
        map,
        ...(color ? { color: new THREE.Color(color) } : {}),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      });
    const haloWideMat = haloMat(auraTex);
    const haloWide = new THREE.Mesh(new THREE.PlaneGeometry(ORB_R * 6.0, ORB_R * 6.0), haloWideMat);
    haloWide.position.z = -0.02;
    haloWide.renderOrder = 2; // the room glow — near-invisible at idle, pulses with her voice
    const haloMidMat = haloMat(auraTex);
    const haloMid = new THREE.Mesh(new THREE.PlaneGeometry(ORB_R * 4.4, ORB_R * 4.4), haloMidMat);
    haloMid.position.z = -0.015;
    haloMid.renderOrder = 3; // the mid bloom falloff
    const haloTightMat = haloMat(dotTex, CYAN);
    const haloTight = new THREE.Mesh(new THREE.PlaneGeometry(ORB_R * 3.0, ORB_R * 3.0), haloTightMat);
    haloTight.position.z = -0.01;
    haloTight.renderOrder = 4; // hot bleed hugging the limb — makes the razor rim read emissive
    orbGroup.add(haloWide, haloMid, haloTight);

    // Shared geometry + shared PLASMA_VERT: the displaced silhouettes of the interior (BackSide)
    // and the surface (FrontSide) stay coincident — feed BOTH the same uTime/uAmp every frame.
    const bodyGeo = new THREE.SphereGeometry(BODY_R, 60, 44);
    const innerMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uAmp: { value: 0.03 }, uFlow: { value: 0.1 }, uOpacity: { value: 0 },
        uCyan: { value: new THREE.Color(CYAN) }, uNavy: { value: new THREE.Color(NAVY) },
      },
      vertexShader: PLASMA_VERT,
      fragmentShader: INNER_FRAG,
      side: THREE.BackSide,
      transparent: true, depthTest: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const inner = new THREE.Mesh(bodyGeo, innerMat);
    inner.renderOrder = 5; // the glowing far wall — drawn BEFORE the front pass, condenses first
    const bodyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uAmp: { value: 0.03 }, uFlow: { value: 0.1 }, uOpacity: { value: 0 },
        uBoil: { value: 0.15 }, uSpeak: { value: 0 }, uTalk: { value: 0 },
        uBlip: { value: 1 }, uIgnite: { value: 0 },
        uCyan: { value: new THREE.Color(CYAN) }, uPlatinum: { value: new THREE.Color(PLATINUM) },
        uNavy: { value: new THREE.Color(NAVY) },
        uKeyVS: { value: KEY_VS.clone() }, uFillVS: { value: FILL_VS.clone() },
      },
      vertexShader: PLASMA_VERT,
      fragmentShader: PLASMA_FRAG,
      side: THREE.FrontSide,
      transparent: true, depthTest: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.renderOrder = 9; // the glass membrane draws over the brain
    orbGroup.add(inner, body);

    // THE NUCLEUS — the bright center of the mind (inverse-fresnel glow ball, reuses CORE shader).
    const nucleusMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color('#8FE9F5') }, uOpacity: { value: 0 } },
      vertexShader: CORE_VERT,
      fragmentShader: CORE_FRAG,
      transparent: true, depthTest: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const nucleus = new THREE.Mesh(new THREE.IcosahedronGeometry(ORB_R * 0.22, 3), nucleusMat);
    nucleus.renderOrder = 6;
    orbGroup.add(nucleus);

    // THE NEURON NETWORK — nodes + synapses inside the glass, slowly rotating in 3D (nodes
    // crossing in front of/behind the nucleus is the parallax that sells real volume).
    const { lines: netGeo, nodes: nodeGeo } = bakeNeuralNet(150, ORB_R);
    const netUniforms = {
      uTime: { value: 0 }, uOpacity: { value: 0 }, uRate: { value: 0.22 }, uFire: { value: 0.7 },
      uTalk: { value: 0 }, uSpeak: { value: 0 }, uOrbR: { value: ORB_R },
      uCyan: { value: new THREE.Color(CYAN) }, uPlatinum: { value: new THREE.Color(PLATINUM) },
    };
    const netMat = new THREE.ShaderMaterial({
      uniforms: netUniforms,
      vertexShader: NET_VERT, fragmentShader: NET_FRAG,
      transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const synapses = new THREE.LineSegments(netGeo, netMat);
    synapses.renderOrder = 7;
    const nodeMat = new THREE.ShaderMaterial({
      uniforms: {
        uDot: { value: dotTex },
        uTime: { value: 0 }, uOpacity: { value: 0 }, uRate: { value: 0.22 }, uFire: { value: 0.7 },
        uTalk: { value: 0 }, uSpeak: { value: 0 }, uOrbR: { value: ORB_R },
        uCyan: { value: new THREE.Color(CYAN) },
      },
      vertexShader: NODE_VERT, fragmentShader: NODE_FRAG,
      transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const neurons = new THREE.Points(nodeGeo, nodeMat);
    neurons.renderOrder = 8;
    neurons.frustumCulled = false;
    const netGroup = new THREE.Group();
    netGroup.add(synapses, neurons);
    orbGroup.add(netGroup);

    // The gauze veils (replace the old wireframe cage): counter-drift happens IN-SHADER on the
    // sample coords, so the meshes never spin — only their slow tilts animate.
    const veilUniforms = (color: string, spin: number) => ({
      uTime: { value: 0 }, uSpin: { value: spin }, uOpacity: { value: 0 }, uFlare: { value: 0 },
      uColor: { value: new THREE.Color(color) },
    });
    const veilAMat = new THREE.ShaderMaterial({
      uniforms: veilUniforms(PLATINUM, 0.12),
      vertexShader: VEIL_VERT, fragmentShader: VEIL_FRAG,
      transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const veilA = new THREE.Mesh(new THREE.SphereGeometry(ORB_R * 1.045, 32, 24), veilAMat);
    veilA.renderOrder = 7;
    const veilBMat = new THREE.ShaderMaterial({
      uniforms: veilUniforms(CYAN, -0.08),
      vertexShader: VEIL_VERT, fragmentShader: VEIL_FRAG,
      transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const veilB = new THREE.Mesh(new THREE.SphereGeometry(ORB_R * 1.1, 32, 24), veilBMat);
    veilB.renderOrder = 8;
    orbGroup.add(veilA, veilB);
    scene.add(orbGroup);

    rig.current = {
      latticeMat, streamMat, bodyMat, innerMat, nucleusMat, netMat, nodeMat, netGroup,
      veilAMat, veilBMat, veilA, veilB,
      haloTightMat, haloMidMat, haloWideMat, orbGroup,
    };
    setRoot(scene);
    // camera never changes after this; the build is aspect-dependent, so rebuild if it did.
  }, [camera]);

  useFrame((st, delta) => {
    const r = rig.current;
    if (!r) return;
    const t = st.clock.elapsedTime % 600; // mediump guard (same as the face scene)

    // reveal clock — damp toward the stage target; report so a parent can crossfade.
    const inbound = revealTarget.current > reveal.current;
    reveal.current = THREE.MathUtils.damp(reveal.current, revealTarget.current, inbound ? 3.0 : 4.5, delta);
    const R = reveal.current;
    onRevealRef.current?.(R);
    const seg = (lo: number, hi: number) => {
      const x = THREE.MathUtils.clamp((R - lo) / (hi - lo), 0, 1);
      return x * x * (3 - 2 * x);
    };

    // speech energy — jawOpen from the shared driver; the star's "voice" signal.
    const lip = lipRef.current;
    const talking = talkingRef.current || (lip?.speaking?.() ?? false);
    lipTargets.current = talking && lip ? lip.sample() : {};
    const speak = lipTargets.current.jawOpen ?? 0;
    const talk = talkingRef.current ? 1 : 0;
    // Brightness model — same as the face: silent 0.88, talking ~1.0 (+ a punch on energy).
    const lit = 0.88 + 0.12 * talk + 0.06 * speak * talk;
    const blip = Math.random() < 0.003 ? 0.82 : 1.0; // the ONE allowed instability (shared: lattice + rim)

    // lattice: ambient Skia look + the cyclone + the talking bottom→top wave (aFaceY = orb height).
    const u = r.latticeMat.uniforms;
    const { selA, selB, fade } = motionSelect(t);
    u.uTime.value = t;
    u.uBlip.value = blip;
    u.uReveal.value = R;
    u.uMorph.value = seg(0.1, 0.62);
    u.uSelA.value = selA; u.uSelB.value = selB; u.uFade.value = fade;
    (u.uDrift.value as THREE.Vector2).set(t * 0.01, t * 0.006);
    u.uSpeak.value = THREE.MathUtils.damp(u.uSpeak.value, speak * 1.2, 8, delta);
    u.uTalk.value = THREE.MathUtils.damp(u.uTalk.value, talk, 5, delta);
    const pulseTarget = 0.12 + 0.88 * seg(0.18, 0.5) * (1 - 0.5 * seg(0.7, 0.95)) + 0.5 * seg(0.7, 0.95);
    u.uPulse.value = THREE.MathUtils.damp(u.uPulse.value, pulseTarget, 3, delta);

    // stream: heavy intake during the morph, quiet feed once formed, livelier while talking.
    const s = r.streamMat.uniforms;
    s.uTime.value = t;
    s.uReveal.value = R;
    s.uFlow.value = THREE.MathUtils.damp(s.uFlow.value, 0.15 + 0.85 * seg(0.1, 0.5) - 0.55 * seg(0.66, 0.92), 3, delta);
    s.uIntake.value = THREE.MathUtils.damp(s.uIntake.value, 0.15 + 1.0 * seg(0.18, 0.5) * (1 - seg(0.55, 0.85)), 3.5, delta);
    s.uSpeak.value = THREE.MathUtils.damp(s.uSpeak.value, speak, 6, delta);

    // ── SHAPE MORPH: poll the bus; dissolve → retarget the dots → re-form ─────
    const req = getVenusOrbShapeRequest();
    const ss = shapeState.current;
    if (req.seq !== ss.seq) {
      ss.seq = req.seq;
      if (req.shape !== ss.showing) ss.pending = req.shape;
    }
    if (ss.pending && stage !== 'pre-render') {
      revealTarget.current = 0.3; // dissolve toward dust…
      if (R < 0.45 && shapeRig.current) {
        // …and at the bottom of the dip, swap her dots' landing targets to the new silhouette.
        const sr = shapeRig.current;
        const pts = ss.pending === 'orb' ? sr.orbTargets : sampleShape(ss.pending, sr.idx.length, ORB_R);
        const tgt = sr.latGeo.getAttribute('aTarget') as THREE.BufferAttribute;
        const fy = sr.latGeo.getAttribute('aFaceY') as THREE.BufferAttribute;
        sr.idx.forEach((li, k) => {
          tgt.setXYZ(li, pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2]);
          fy.setX(li, ss.pending === 'orb' ? sr.orbFaceY[k] : THREE.MathUtils.clamp(pts[k * 3 + 1] / (2.6 * ORB_R) + 0.5, 0, 1));
        });
        tgt.needsUpdate = true;
        fy.needsUpdate = true;
        ss.showing = ss.pending;
        ss.pending = null;
        revealTarget.current = 1; // …then cyclone onto the object
      }
    }
    // While a non-orb object is showing, the sphere-shaped layers step back and the dots lead.
    ss.gate = THREE.MathUtils.damp(ss.gate, ss.showing !== 'orb' || ss.pending ? 1 : 0, 4, delta);
    const sphereDim = 1 - 0.97 * ss.gate; // membrane/inner/veils/halos — the sphere must GO AWAY
    const mindDim = 1 - 0.88 * ss.gate;   // nucleus/net (a faint mind lingers inside the object)
    u.uLead.value = ss.gate;              // dots take over the drawing while an object shows

    // ── the plasma drive block (spec: docs/studio/VENUS_AVATAR.md orb v2) ─────
    const spk = Math.min(1, u.uSpeak.value / 1.2); // normalized damped speech (lattice damps toward speak*1.2)
    const tk = u.uTalk.value;                      // damped talking gate
    const formed = seg(0.45, 0.8);
    // SILHOUETTE LOCK: body and inner MUST receive identical uTime/uAmp/uFlow.
    // The blob MORPHS while she talks: big displacement lobes riding speech energy (crests
    // deliberately break the dot skin now — sparks half-buried in plasma read organic).
    const amp = Math.min(0.3, 0.05 + 0.015 * Math.sin(t * 0.5) + 0.26 * spk * tk);
    const flow = 0.1 + 0.08 * tk + 0.45 * spk * tk; // the noise field streams faster on syllables
    const surge = seg(0.6, 0.85) * (1 - seg(0.85, 0.97));  // newborn churn at formation
    const ignite = seg(0.5, 0.8) * (1 - seg(0.82, 0.96));  // landing brightness flash
    const b = r.bodyMat.uniforms, n = r.innerMat.uniforms;
    b.uTime.value = t; n.uTime.value = t;
    b.uAmp.value = amp; n.uAmp.value = amp;
    b.uFlow.value = flow; n.uFlow.value = flow;
    b.uBoil.value = THREE.MathUtils.damp(b.uBoil.value, 0.15 + 0.55 * tk + 0.45 * spk + 0.6 * surge, 4, delta);
    b.uSpeak.value = spk; b.uTalk.value = tk; b.uBlip.value = blip; b.uIgnite.value = ignite;
    b.uOpacity.value = 0.55 * formed * lit * sphereDim; // TRANSLUCENT membrane — the brain must read through
    n.uOpacity.value = 0.4 * seg(0.42, 0.72) * lit * sphereDim; // faint far wall

    // the brain: nucleus condenses first, then the web ignites; firing rate rides her voice
    r.nucleusMat.uniforms.uOpacity.value = (0.7 + 0.15 * Math.sin(t * 0.5) + 0.9 * spk * tk) * seg(0.42, 0.72) * lit * mindDim;
    const nm = r.netMat.uniforms, nd = r.nodeMat.uniforms;
    nm.uTime.value = t; nd.uTime.value = t;
    nm.uTalk.value = tk; nd.uTalk.value = tk;
    nm.uSpeak.value = spk; nd.uSpeak.value = spk;
    nm.uRate.value = 0.22 + 0.15 * tk + 0.9 * spk * tk;   // synapses fire faster as she speaks
    nd.uRate.value = nm.uRate.value;
    nm.uFire.value = 0.7 + 1.3 * spk * tk;
    nd.uFire.value = nm.uFire.value;
    nm.uOpacity.value = 0.9 * formed * lit * mindDim;
    nd.uOpacity.value = formed * lit * mindDim;
    // slow 3D tumble — neurons crossing in front of/behind the nucleus = the volume tell
    r.netGroup.rotation.y = t * 0.1;
    r.netGroup.rotation.x = Math.sin(t * 0.13) * 0.15;
    r.veilAMat.uniforms.uTime.value = t; r.veilBMat.uniforms.uTime.value = t;
    r.veilAMat.uniforms.uOpacity.value = 0.15 * lit * seg(0.55, 0.85) * sphereDim;
    r.veilBMat.uniforms.uOpacity.value = 0.11 * lit * seg(0.6, 0.9) * sphereDim;
    r.veilAMat.uniforms.uFlare.value = 0.3 * spk * tk;  // corona surges on syllables (0 at idle)
    r.veilBMat.uniforms.uFlare.value = 0.22 * spk * tk;
    r.haloTightMat.opacity = 0.42 * lit * formed * sphereDim;
    r.haloMidMat.opacity = 0.2 * lit * seg(0.55, 0.9) * sphereDim;
    r.haloWideMat.opacity = (0.07 + 0.3 * spk * tk) * seg(0.65, 0.95) * sphereDim; // she lights the room on each phrase
    r.veilA.rotation.x = Math.sin(t * 0.19) * 0.22; // slow tilts (the spin lives in-shader)
    r.veilB.rotation.z = Math.sin(t * 0.14) * 0.18;

    // the whole star hovers — a slow bob, nothing humanoid.
    r.orbGroup.position.y = Math.sin(t * 0.5) * 0.006;
  });

  return root ? <primitive object={root} /> : null;
}

// Same contract as VenusHeadScene: transparent canvas (the lattice IS the background),
// `stage` drives the lifecycle, `onReveal` reports assembly progress.
export default function VenusOrbScene({ stage = 'talking', onReveal }: { stage?: VenusStage; onReveal?: (r: number) => void }) {
  return (
    <Canvas camera={{ position: [0, 0, 2], fov: 22 }} style={{ flex: 1 }} gl={{ alpha: true }}>
      <Orb stage={stage} onReveal={onReveal} />
    </Canvas>
  );
}

export type { VenusStage };
