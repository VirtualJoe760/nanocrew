import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { createVenusLipsync, type VenusLipsync, type VisemeWeights } from '@/lib/venus-lipsync';
import { LATTICE_VERT, LATTICE_FRAG, motionSelect } from './venus-points';
import { STREAM_VERT, STREAM_FRAG } from './venus-shaders';
import { makeAuraTexture, makeDotTexture } from './venus-textures';
import { bakeAurora, bakeStreamField, bakeUnifiedLattice, LAT_ROWS } from './venus-geometry';
import {
  PLASMA_VERT, SHEATH_FRAG, NUCLEUS_VERT, NUCLEUS_FRAG,
  NET_VERT, NET_FRAG, NODE_VERT, NODE_FRAG, DUST_VERT, DUST_FRAG,
} from './venus-plasma';
import { getVenusOrbShapeRequest, setVenusOrbShape, type VenusOrbShape } from './venus-orb-bus';

// Her lifecycle (formerly declared in venus-head-scene, the retired Cortana face build).
type VenusStage = 'pre-render' | 'morphing' | 'silence' | 'talking';

// ── Venus ORB v3 — the "NEURAL CONSTELLATION" (R3F) ─────────────────────────
// Art direction 2026-07-04: "get away from it looking like an orb… keeping the nucleus…
// really we want it looking like a visual representation of a neural network… way more detail."
// Every spherical surface is GONE. Venus is now an irregular, tilted 3D constellation of ~880
// neuron somas grouped into 7 art-directed ganglia + 3 reaching dendritic arms, wired by ~34k
// verts of curved dendrites, braided 3-strand trunk axons, tip-tapered whisker fuzz, and a dim
// long-range web — all rooted into a white-hot nucleus wrapped in a small boiling plasma sheath
// (the only surviving plasma surface). Signal packets race the wires on a per-ganglion staggered
// clock; at idle one ganglion at a time flares (she is thinking); talking sets the whole web
// storming. The app's dot-field background still peels up and cyclones onto the SOMA positions
// (the same unified lattice + morph as ever), so the tee/heart/bolt shape-morph system survives.
// Full spec + tuning knobs: docs/studio/VENUS_AVATAR.md (orb v3). Shaders: venus-plasma.ts.
//
// This is Venus's ONLY embodiment now — the Cortana-era humanoid build (venus-head-scene)
// has been retired and deleted.

const ORB_R = 0.26; // the scale unit ("R") — camera at z=2 / fov 22 gives ~0.39 half-height
const ORB_DOTS = 880; // lattice dots = soma count (1:1 dots↔somas is the morph contract)
const CYAN = '#5BD8E6';
const PLATINUM = '#cdd1d9';
const NAVY = '#0B1626';
const NET_SEED = 1337; // mulberry32 seed — the whole constellation is reproducible frame-to-frame

// Independent per-part palettes (art direction 2026-07-04: "introduce more colors… net, limbic,
// nucleus should all color independently… shift on a musical bpm count, say 80bpm"): each part
// cycles A↔B on its OWN hue clock; the 80bpm beat surges every clock + pops brightness.
const NET_A = '#3FE0C5', NET_B = '#4E8DFF';   // net: aqua-teal ↔ azure
const LIM_A = '#B36CFF', LIM_B = '#FF5FA2';   // limbic snakes: violet ↔ rose
const NUC_A = '#DFF6FF', NUC_B = '#C77DFF';   // nucleus: ice ↔ pale violet
const SHE_A = '#5BD8E6', SHE_B = '#7B8CFF';   // sheath: cyan ↔ periwinkle

// THE RADIUS LADDER (load-bearing): nucleus 0.18R < sheath 0.30R < clearance gap (no somas)
// to 0.38R < nucleus ring 0.40–0.44R < ganglia cloud 0.42R–1.15R < arms out to 1.42R (hard cap).
// The gap between sheath and ring is a composition beat — core, a breath of black, then the web.
const NUC_R = ORB_R * 0.18;
const SHEATH_R = ORB_R * 0.3;
const CLEAR_R = ORB_R * 0.38;
const ARM_CAP = ORB_R * 1.42;

// GANGLIA TABLE (art-directed — iterate these rows from __venusOrbStep stills; the camera is
// fixed at +z so the projected XY layout IS the composition). Units of R:
// [ cx, cy, cz,  sx, sy, sz,  weight ] — per-axis gaussian spreads; each ganglion also gets a
// seeded random tilt so every cluster is a tilted LENS, not an axis-aligned puff.
// NOTE the z values: the centers are deliberately SPREAD IN AZIMUTH around the Y spin axis
// (≈29°/-150°/72°/-124°/-12°/152°/-85°) so the rotating cloud shows similar mass at every
// angle — clustered azimuths made the sides go sparse mid-rotation. Z moves don't change the
// head-on composition, only the side views.
const GANGLIA: number[][] = [
  [0.62, 0.3, 0.35, 0.28, 0.2, 0.22, 0.2],    // G1 right lobe
  [-0.7, 0.12, -0.4, 0.24, 0.26, 0.2, 0.18],  // G2 left lobe, behind
  [0.18, -0.58, 0.55, 0.22, 0.18, 0.24, 0.15], // G3 lower, well in front
  [-0.3, 0.62, -0.45, 0.2, 0.22, 0.18, 0.13],  // G4 upper-left, behind
  [0.95, -0.25, -0.2, 0.14, 0.12, 0.14, 0.08],  // G5 OUTRIGGER (breaks the hull)
  [-0.85, -0.55, 0.45, 0.12, 0.14, 0.12, 0.07], // G6 OUTRIGGER, front
  [0.05, 0.15, -0.55, 0.26, 0.24, 0.2, 0.19],   // G7 rear depth ganglion (the parallax layer)
];
// soma budget: 640 ganglia (by weight) + 180 arm (3 arms × 5 clusters × 12) + 20 nucleus ring
// + 40 interstitial strays = 880 = ORB_DOTS exactly.
const GANG_POPS = [128, 115, 96, 83, 51, 45, 122];

// Deterministic PRNG — the bake must produce the SAME constellation every mount so tuning
// sessions (and the ganglia table) stay comparable still-to-still.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── SHAPE MORPH: 2D object silhouettes the dots can re-form into ────────────
// Flat point clouds facing the fixed camera read crisply. Each sampler rejection-fills a unit
// silhouette; the caller scales by ~1.15R·layoutScale (objects hold scale vs the wide cloud).
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
function sampleShape(name: VenusOrbShape, count: number, S: number): Float32Array {
  const out = new Float32Array(count * 3);
  let i = 0, guard = 0;
  while (i < count && guard < count * 400) {
    guard++;
    const x = Math.random() * 2.6 - 1.3;
    const y = Math.random() * 2.6 - 1.3;
    if (!insideShape(name, x, y)) continue;
    out[i * 3] = x * S;
    out[i * 3 + 1] = y * S;
    out[i * 3 + 2] = (Math.random() - 0.5) * S * 0.05;
    i++;
  }
  return out;
}

type OrbRig = {
  latticeMat: THREE.ShaderMaterial;
  streamMat: THREE.ShaderMaterial;
  sheathMat: THREE.ShaderMaterial;
  nucleusMat: THREE.ShaderMaterial;
  nucleus: THREE.Mesh;
  netMat: THREE.ShaderMaterial;
  nodeMat: THREE.ShaderMaterial;
  dustMat: THREE.ShaderMaterial;
  netGroup: THREE.Group;
  haloTightMat: THREE.MeshBasicMaterial;
  haloWideMat: THREE.MeshBasicMaterial;
  orbGroup: THREE.Group;
};

// ── bakeConnectome — the whole constellation, built ONCE (all positions in R units; the
// framing scale is applied on orbGroup + the lattice handoff copy). Returns the merged wiring
// LineSegments (aClass 0 fine web / 1 dendrite / 2 trunk / 3 whisker), the soma Points, the
// ghost dust Points, an aurora-baked soma geometry for the unified lattice, and the cloud's
// y extents (drives the world-Y talking band).
function bakeConnectome(R: number): {
  lines: THREE.BufferGeometry;
  nodes: THREE.BufferGeometry;
  dust: THREE.BufferGeometry;
  somaPositions: Float32Array;
  yMin: number;
  ySpan: number;
} {
  const rnd = mulberry32(NET_SEED);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
  const randDir = () => {
    const u = rnd() * 2 - 1;
    const ph = rnd() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    return new THREE.Vector3(s * Math.cos(ph), u, s * Math.sin(ph));
  };

  type Soma = { p: THREE.Vector3; gang: number };
  const somas: Soma[] = [];
  const centers = GANGLIA.map((g) => new THREE.Vector3(g[0], g[1], g[2]).multiplyScalar(R));

  // 1) ganglia — tilted gaussian lenses, kept off the nucleus and inside a loose hull
  GANGLIA.forEach((g, gi) => {
    const tilt = new THREE.Quaternion().setFromAxisAngle(randDir(), rnd() * Math.PI * 2);
    for (let k = 0; k < GANG_POPS[gi]; k++) {
      const p = new THREE.Vector3();
      for (let attempt = 0; attempt < 8; attempt++) {
        p.set(gauss() * g[3] * R, gauss() * g[4] * R, gauss() * g[5] * R)
          .applyQuaternion(tilt)
          .add(centers[gi]);
        const len = p.length();
        if (len >= CLEAR_R && len <= R * 1.55) break;
        if (attempt === 7) p.setLength(THREE.MathUtils.clamp(len, CLEAR_R, R * 1.55));
      }
      somas.push({ p, gang: gi + 1 });
    }
  });

  // 2) three dendritic ARMS reaching past the hull (from the peripheral ganglia) — these break
  //    the round outline more than anything else.
  const armClusters: number[][] = [];
  for (const gi of [4, 5, 2]) {
    let c = centers[gi].clone();
    let dir = c.clone().normalize();
    for (let step = 0; step < 5; step++) {
      dir = dir.add(randDir().multiplyScalar(0.15)).normalize();
      c = c.clone().addScaledVector(dir, 0.09 * R);
      if (c.length() > ARM_CAP) c.setLength(ARM_CAP);
      const members: number[] = [];
      for (let k = 0; k < 12; k++) {
        const p = c.clone().add(new THREE.Vector3(gauss(), gauss(), gauss()).multiplyScalar(0.05 * R));
        members.push(somas.length);
        somas.push({ p, gang: gi + 1 });
      }
      armClusters.push(members);
    }
  }

  // 3) nucleus ring — the roots the trunks dive into (gang 0, grow≈0: they light FIRST)
  const ringStart = somas.length;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < 20; i++) {
    const y = 1 - (i / 19) * 2;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * i;
    const p = new THREE.Vector3(Math.cos(th) * rr, y, Math.sin(th) * rr)
      .add(randDir().multiplyScalar(0.06))
      .normalize()
      .multiplyScalar(R * (0.4 + 0.04 * rnd()));
    somas.push({ p, gang: 0 });
  }
  const ringEnd = somas.length;

  // 4) interstitial strays — lone cells in the superquadric envelope (the loose overall hull)
  const inEnvelope = (p: THREE.Vector3) =>
    Math.pow(Math.abs(p.x - 0.06 * R) / (1.3 * R), 2.2) +
      Math.pow(Math.abs(p.y + 0.04 * R) / (1.02 * R), 2.2) +
      Math.pow(Math.abs(p.z) / (0.8 * R), 2.2) <=
    1;
  let strays = 0, strayGuard = 0;
  while (strays < 40 && strayGuard++ < 4000) {
    const p = new THREE.Vector3((rnd() * 2 - 1) * 1.3 * R, (rnd() * 2 - 1) * 1.02 * R, (rnd() * 2 - 1) * 0.8 * R);
    if (!inEnvelope(p) || p.length() < CLEAR_R) continue;
    somas.push({ p, gang: 0 });
    strays++;
  }
  const INNER_N = somas.length; // = ORB_DOTS — the lattice/shape-morph contract covers ONLY these

  // 4b) THE OUTER REACHES — "just keep building the net": ~10 more ganglia in an even-azimuth
  // ring out to ~2.2R, alternating high/low, so the network PHYSICALLY extends past the screen
  // diagonal in every direction (including depth) — rotation can never show its end. Coverage
  // by construction, not by stretching. These somas are wiring/Points only (not morph targets).
  const outerCenters: THREE.Vector3[] = [];
  for (let gi = 0; gi < 10; gi++) {
    const az = (gi / 10) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
    const rad = R * (1.35 + 0.75 * rnd());
    const yy = (gi % 2 === 0 ? 1 : -1) * R * (0.2 + 1.1 * rnd());
    const c = new THREE.Vector3(Math.cos(az) * rad, yy, Math.sin(az) * rad);
    outerCenters.push(c);
    const tilt = new THREE.Quaternion().setFromAxisAngle(randDir(), rnd() * Math.PI * 2);
    const pop = 34 + Math.floor(rnd() * 16);
    const sig = new THREE.Vector3(0.18 + 0.12 * rnd(), 0.16 + 0.1 * rnd(), 0.18 + 0.12 * rnd()).multiplyScalar(R);
    for (let k = 0; k < pop; k++) {
      const p = new THREE.Vector3(gauss() * sig.x, gauss() * sig.y, gauss() * sig.z)
        .applyQuaternion(tilt)
        .add(c);
      somas.push({ p, gang: 8 + gi });
    }
  }
  const N = somas.length;

  // 5) hubs — the soma nearest each ganglion center, snapped exactly onto it
  const hubIdx = centers.map((c, gi) => {
    let best = 0, bd = 1e9;
    somas.forEach((s, i) => {
      if (s.gang !== gi + 1) return;
      const d = s.p.distanceTo(c);
      if (d < bd) { bd = d; best = i; }
    });
    somas[best].p.copy(c);
    return best;
  });
  const hubSet = new Set(hubIdx);

  // 6) spatial hash (cell 0.15R) — keeps the kNN pass O(n·k)
  const cell = 0.15 * R;
  const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const grid = new Map<string, number[]>();
  somas.forEach((s, i) => {
    const k = cellKey(Math.floor(s.p.x / cell), Math.floor(s.p.y / cell), Math.floor(s.p.z / cell));
    const bucket = grid.get(k);
    if (bucket) bucket.push(i);
    else grid.set(k, [i]);
  });
  const neighbors = (i: number, maxD: number, sameGang: boolean): { j: number; d: number }[] => {
    const s = somas[i];
    const cx = Math.floor(s.p.x / cell), cy = Math.floor(s.p.y / cell), cz = Math.floor(s.p.z / cell);
    const range = Math.ceil(maxD / cell);
    const out: { j: number; d: number }[] = [];
    for (let dx = -range; dx <= range; dx++)
      for (let dy = -range; dy <= range; dy++)
        for (let dz = -range; dz <= range; dz++) {
          const bucket = grid.get(cellKey(cx + dx, cy + dy, cz + dz));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j === i) continue;
            const same = somas[j].gang === s.gang;
            if (sameGang ? !same : same || somas[j].gang === 0) continue;
            const d = s.p.distanceTo(somas[j].p);
            if (d <= maxD) out.push({ j, d });
          }
        }
    return out.sort((a, b) => a.d - b.d);
  };

  // 7) node-level edges (pre-curve) — dendrites intra-ganglion, a sparse cross-stitch, arm
  //    chain links, and the trunk paths. This graph also feeds the BFS growth field.
  type Edge = { a: number; b: number; cls: number };
  const nodeEdges: Edge[] = [];
  const seen = new Set<string>();
  const degree = new Array<number>(N).fill(0);
  const addEdge = (a: number, b: number, cls: number) => {
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(k)) return;
    seen.add(k);
    nodeEdges.push({ a, b, cls });
    degree[a]++;
    degree[b]++;
  };
  for (let i = 0; i < N; i++) {
    if (somas[i].gang === 0) continue;
    const k = somas[i].gang <= 2 ? 3 : 2; // the big lobes wire denser
    for (const { j } of neighbors(i, 0.3 * R, true).slice(0, k)) addEdge(i, j, 1);
  }
  for (let i = 0; i < N; i++) {
    if (somas[i].gang === 0 || rnd() >= 0.15) continue;
    const near = neighbors(i, 0.45 * R, false);
    if (near.length) addEdge(i, near[0].j, 1);
  }
  for (let a = 0; a < armClusters.length; a++) {
    if (a % 5 === 0) continue; // the first cluster of each arm reaches its ganglion via kNN
    const prev = armClusters[a - 1], cur = armClusters[a];
    let bi = -1, bj = -1, bd = 1e9;
    for (const i of cur)
      for (const j of prev) {
        const d = somas[i].p.distanceTo(somas[j].p);
        if (d < bd) { bd = d; bi = i; bj = j; }
      }
    if (bi >= 0) addEdge(bi, bj, 1);
  }
  // hub arterials: hub↔hub + every hub roots to its nearest nucleus-ring soma. Rendered as
  // ordinary dendrites (class 1) — the LIMBIC class (2) now lives on closed orbital loops
  // instead, so its snakes visibly circle the core. These edges still carry the BFS.
  const HUB_PAIRS: [number, number][] = [[1, 2], [1, 3], [1, 5], [2, 4], [2, 6], [3, 6], [3, 7], [4, 7], [1, 7], [2, 7]];
  const rootPaths: [number, number][] = HUB_PAIRS.map(([a, b]) => [hubIdx[a - 1], hubIdx[b - 1]]);
  for (const h of hubIdx) {
    let best = ringStart, bd = 1e9;
    for (let i = ringStart; i < ringEnd; i++) {
      const d = somas[h].p.distanceTo(somas[i].p);
      if (d < bd) { bd = d; best = i; }
    }
    rootPaths.push([h, best]);
  }
  for (const [a, b] of rootPaths) addEdge(a, b, 1);
  // outer roots: each outer ganglion grafts onto the nearest inner tissue — ONE net, kept
  // growing outward (the BFS growth field and the energy crawl extend into it naturally).
  for (let gi = 0; gi < outerCenters.length; gi++) {
    let oc = -1, od = 1e9;
    for (let i = INNER_N; i < N; i++) {
      if (somas[i].gang !== 8 + gi) continue;
      const d = somas[i].p.distanceTo(outerCenters[gi]);
      if (d < od) { od = d; oc = i; }
    }
    if (oc < 0) continue;
    let bi = -1, bd = 1e9;
    for (let i = 0; i < INNER_N; i++) {
      const d = somas[i].p.distanceTo(somas[oc].p);
      if (d < bd) { bd = d; bi = i; }
    }
    if (bi >= 0) addEdge(oc, bi, 1);
  }

  // 8) aGrow — BFS depth from the nucleus ring, normalized: the network "wires itself outward
  //    from the nucleus" as the drive sweeps uGrow 0→1 during assembly.
  const adj: number[][] = Array.from({ length: N }, () => []);
  for (const e of nodeEdges) {
    adj[e.a].push(e.b);
    adj[e.b].push(e.a);
  }
  const depth = new Array<number>(N).fill(-1);
  const queue: number[] = [];
  for (let i = ringStart; i < ringEnd; i++) {
    depth[i] = 0;
    queue.push(i);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi];
    for (const j of adj[i])
      if (depth[j] < 0) {
        depth[j] = depth[i] + 1;
        queue.push(j);
      }
  }
  let maxDepth = 1;
  for (const d of depth) if (d > maxDepth) maxDepth = d;
  const grow = depth.map((d) => (d < 0 ? 0.7 + 0.3 * rnd() : d / maxDepth));
  for (let i = ringStart; i < ringEnd; i++) grow[i] = 0.05;

  // 9) curve emission → ONE merged LineSegments buffer
  const lp: number[] = [], lT: number[] = [], lPh: number[] = [], lCl: number[] = [];
  const lGa: number[] = [], lBr: number[] = [], lGr: number[] = [], lJit: number[] = [];
  const emit = (pts: THREE.Vector3[], cls: number, gang: number, phase: number, bright: number, growVal: number, jitScale: number) => {
    const jd = randDir().multiplyScalar(jitScale);
    const S = pts.length - 1;
    for (let s = 0; s < S; s++) {
      for (const [pt, tt] of [
        [pts[s], s / S],
        [pts[s + 1], (s + 1) / S],
      ] as [THREE.Vector3, number][]) {
        lp.push(pt.x, pt.y, pt.z);
        lT.push(tt);
        lPh.push(phase);
        lCl.push(cls);
        lGa.push(gang);
        lBr.push(bright);
        lGr.push(growVal);
        lJit.push(jd.x, jd.y, jd.z);
      }
    }
  };
  const perpOf = (a: THREE.Vector3, b: THREE.Vector3) => {
    const ab = b.clone().sub(a);
    let perp = new THREE.Vector3().crossVectors(ab, randDir());
    if (perp.lengthSq() < 1e-8) perp = new THREE.Vector3().crossVectors(ab, new THREE.Vector3(0, 1, 0));
    if (perp.lengthSq() < 1e-8) perp.set(1, 0, 0);
    return perp.normalize();
  };
  const quadBezier = (a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, S: number, jitAmp: number) => {
    const pts: THREE.Vector3[] = [];
    for (let s = 0; s <= S; s++) {
      const t = s / S, u = 1 - t;
      const p = new THREE.Vector3().addScaledVector(a, u * u).addScaledVector(c, 2 * u * t).addScaledVector(b, t * t);
      if (s > 0 && s < S) p.add(randDir().multiplyScalar(jitAmp)); // frozen organic wobble
      pts.push(p);
    }
    return pts;
  };

  // dendrites (aClass 1): quadratic arcs, S=6
  for (const e of nodeEdges) {
    if (e.cls !== 1) continue;
    const a = somas[e.a].p, b = somas[e.b].p;
    const len = a.distanceTo(b);
    const ctrl = a.clone().add(b).multiplyScalar(0.5).addScaledVector(perpOf(a, b), len * (0.1 + 0.1 * rnd()));
    emit(quadBezier(a, ctrl, b, 6, 0.01 * R), 1, somas[e.a].gang, rnd(), 0.6 + 0.8 * rnd(), Math.max(grow[e.a], grow[e.b]), 1.0);
  }

  // LIMBIC LOOPS (aClass 2): closed orbital paths winding around the nucleus — wobbly tilted
  // ovals (integer harmonics keep the seam closed), 3 braided strands, S=48. The snakes ride
  // aT around these loops, so their motion IS a circling of the core ("think snake the game…
  // growing and moving around the nucleus").
  for (let li = 0; li < 6; li++) {
    const tiltQ = new THREE.Quaternion().setFromAxisAngle(randDir(), rnd() * Math.PI * 2);
    const r0 = R * (0.42 + 0.22 * rnd());
    const ph1 = rnd() * Math.PI * 2, ph2 = rnd() * Math.PI * 2, ph3 = rnd() * Math.PI * 2;
    const S = 48;
    const phase = rnd();
    const gVal = 0.12 + 0.1 * rnd(); // near the core → lights early in the assembly
    for (let strand = 0; strand < 3; strand++) {
      const pts: THREE.Vector3[] = [];
      for (let s = 0; s <= S; s++) {
        const th = (s / S) * Math.PI * 2;
        const rr = r0 * (1 + 0.12 * Math.sin(2 * th + ph1) + 0.08 * Math.sin(3 * th + ph2));
        const p = new THREE.Vector3(Math.cos(th) * rr, Math.sin(2 * th + ph3) * 0.1 * R, Math.sin(th) * rr)
          .applyQuaternion(tiltQ);
        const tang = new THREE.Vector3(-Math.sin(th), 0, Math.cos(th)).applyQuaternion(tiltQ);
        const n1 = new THREE.Vector3().crossVectors(tang, p.clone().normalize());
        if (n1.lengthSq() < 1e-8) n1.set(0, 1, 0);
        n1.normalize();
        const n2 = new THREE.Vector3().crossVectors(tang, n1).normalize();
        const ang = (strand / 3) * Math.PI * 2 + (s / S) * Math.PI * 4; // 2 braid turns (closed)
        p.addScaledVector(n1, Math.cos(ang) * 0.01 * R).addScaledVector(n2, Math.sin(ang) * 0.01 * R);
        pts.push(p);
      }
      emit(pts, 2, 0, phase, 0.9 + 0.4 * rnd(), gVal, 0.4);
    }
  }

  // whiskers (aClass 3): 2 stubs per soma (4 on busy hubs), curling outward from the ganglion —
  // the fine fuzz that makes every cell read ALIVE up close. Tip-tapered in the shader.
  for (let i = 0; i < N; i++) {
    const nStubs = degree[i] >= 4 ? 4 : 2;
    // "away" = out of the owning ganglion (inner table, outer ring, or radially for gang 0)
    const g = somas[i].gang;
    const gc = g === 0 ? null : g <= GANGLIA.length ? centers[g - 1] : outerCenters[g - 8];
    const away = gc ? somas[i].p.clone().sub(gc) : somas[i].p.clone();
    for (let w = 0; w < nStubs; w++) {
      let dir = away.lengthSq() > 1e-8 ? away.clone().normalize() : randDir();
      dir = dir.add(randDir().multiplyScalar(0.7)).normalize();
      const len = R * (0.03 + 0.05 * rnd());
      const p0 = somas[i].p;
      const p1 = p0.clone().addScaledVector(dir, len * 0.5);
      const curl = dir.clone().addScaledVector(perpOf(p0, p1), 0.36).normalize();
      const p2 = p1.clone().addScaledVector(curl, len * 0.5);
      emit([p0, p1, p2], 3, somas[i].gang, rnd(), 0.6 + 0.8 * rnd(), Math.min(1, grow[i] + 0.06), 1.5);
    }
  }

  // fine web (aClass 0): 1,300 dim long-range threads — with the ghost dust this replaces the
  // deleted veils' volumetric depth (raised for the outer reaches).
  let fine = 0, fineGuard = 0;
  while (fine < 1300 && fineGuard++ < 26000) {
    const i = Math.floor(rnd() * N), j = Math.floor(rnd() * N);
    if (i === j || somas[i].gang === somas[j].gang) continue;
    const a = somas[i].p, b = somas[j].p;
    const len = a.distanceTo(b);
    if (len > 1.3 * R) continue;
    const ctrl = a.clone().add(b).multiplyScalar(0.5).addScaledVector(perpOf(a, b), 0.06 * len);
    emit(quadBezier(a, ctrl, b, 4, 0.01 * R), 0, 0, rnd(), 0.6 + 0.8 * rnd(), 0.75 + 0.2 * rnd(), 0.7);
    fine++;
  }

  // VOID THREADS (aClass 0): the net does not END — ~300 dim threads continue radially outward
  // from the (now much farther) periphery, running past the screen diagonal at every rotation
  // ("like our universe expands — we shouldn't see the end of the net").
  let voids = 0, voidGuard = 0;
  while (voids < 300 && voidGuard++ < 6000) {
    const i = Math.floor(rnd() * N);
    const a = somas[i].p;
    if (a.length() < 1.3 * R) continue;
    const b = a.clone().multiplyScalar(1.35 + 0.8 * rnd()).add(randDir().multiplyScalar(0.22 * R));
    const ctrl = a.clone().add(b).multiplyScalar(0.5).addScaledVector(perpOf(a, b), 0.08 * a.distanceTo(b));
    emit(quadBezier(a, ctrl, b, 4, 0.012 * R), 0, 0, rnd(), 0.4 + 0.5 * rnd(), 0.85 + 0.15 * rnd(), 0.7);
    voids++;
  }

  const lines = new THREE.BufferGeometry();
  lines.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lp), 3));
  lines.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(lT), 1));
  lines.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(lPh), 1));
  lines.setAttribute('aClass', new THREE.BufferAttribute(new Float32Array(lCl), 1));
  lines.setAttribute('aGang', new THREE.BufferAttribute(new Float32Array(lGa), 1));
  lines.setAttribute('aBright', new THREE.BufferAttribute(new Float32Array(lBr), 1));
  lines.setAttribute('aGrow', new THREE.BufferAttribute(new Float32Array(lGr), 1));
  lines.setAttribute('aJit', new THREE.BufferAttribute(new Float32Array(lJit), 3));

  // soma Points: power-law sizes (many grains, few anchors) with hub/ring floors
  const nodePos = new Float32Array(N * 3);
  const nPh = new Float32Array(N), nSz = new Float32Array(N), nGa = new Float32Array(N);
  const nHub = new Float32Array(N), nGr = new Float32Array(N);
  let yMin = 1e9, yMax = -1e9;
  somas.forEach((s, i) => {
    nodePos[i * 3] = s.p.x;
    nodePos[i * 3 + 1] = s.p.y;
    nodePos[i * 3 + 2] = s.p.z;
    yMin = Math.min(yMin, s.p.y);
    yMax = Math.max(yMax, s.p.y);
    nPh[i] = rnd() + s.gang * 0.13; // folds the per-ganglion stagger into the phase
    let sz = 9 + 46 * Math.pow(rnd(), 3);
    if (hubSet.has(i)) sz = Math.max(sz, 40);
    else if (degree[i] >= 4) sz = Math.max(sz, 28);
    else if (i >= ringStart && i < ringEnd) sz = Math.max(sz, 22);
    nSz[i] = sz;
    nGa[i] = s.gang;
    nHub[i] = hubSet.has(i) ? 1 : 0;
    nGr[i] = grow[i];
  });
  const nodes = new THREE.BufferGeometry();
  nodes.setAttribute('position', new THREE.BufferAttribute(nodePos, 3));
  nodes.setAttribute('aPhase', new THREE.BufferAttribute(nPh, 1));
  nodes.setAttribute('aSize', new THREE.BufferAttribute(nSz, 1));
  nodes.setAttribute('aGang', new THREE.BufferAttribute(nGa, 1));
  nodes.setAttribute('aHub', new THREE.BufferAttribute(nHub, 1));
  nodes.setAttribute('aGrow', new THREE.BufferAttribute(nGr, 1));

  // ghost dust: 400 motes in the envelope (interstitial fill) + 500 in an OUTER SHELL out to
  // ~2.6R — with the void threads, the far field never ends on-screen.
  const DUST_N = 900;
  const dustPos = new Float32Array(DUST_N * 3), dPh = new Float32Array(DUST_N);
  let dCount = 0, dGuard = 0;
  while (dCount < 400 && dGuard++ < 40000) {
    const p = new THREE.Vector3((rnd() * 2 - 1) * 1.3 * R, (rnd() * 2 - 1) * 1.02 * R, (rnd() * 2 - 1) * 0.8 * R);
    if (!inEnvelope(p) || p.length() < SHEATH_R * 1.1) continue;
    dustPos[dCount * 3] = p.x;
    dustPos[dCount * 3 + 1] = p.y;
    dustPos[dCount * 3 + 2] = p.z;
    dPh[dCount] = rnd();
    dCount++;
  }
  while (dCount < DUST_N) {
    const p = randDir().multiplyScalar(R * (1.05 + 1.55 * rnd()));
    dustPos[dCount * 3] = p.x;
    dustPos[dCount * 3 + 1] = p.y;
    dustPos[dCount * 3 + 2] = p.z;
    dPh[dCount] = rnd();
    dCount++;
  }
  const dust = new THREE.BufferGeometry();
  dust.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  dust.setAttribute('aPhase', new THREE.BufferAttribute(dPh, 1));

  return { lines, nodes, dust, somaPositions: nodePos, yMin, ySpan: Math.max(1e-4, yMax - yMin) };
}

// STATIC FAR WEB — a dim backdrop of threads filling the whole view rect (+35% overshoot)
// BEHIND the cloud. Infinitely-far things don't parallax: this layer never rotates, so the
// frame is covered at EVERY spin angle — the rotating net lives inside a universe with no
// visible end. Shares the NET material, so it rides the same color clocks / crawl / sparks.
function bakeFarWeb(vW: number, vH: number): THREE.BufferGeometry {
  const rnd = mulberry32(NET_SEED + 7);
  const vec = (x: number, y: number, z: number, len: number) => {
    const v = new THREE.Vector3(x, y, z);
    if (v.lengthSq() < 1e-9) v.set(1, 0, 0);
    return v.setLength(len);
  };
  const lp: number[] = [], lT: number[] = [], lPh: number[] = [], lCl: number[] = [];
  const lGa: number[] = [], lBr: number[] = [], lGr: number[] = [], lJit: number[] = [];
  for (let e = 0; e < 380; e++) {
    const a = new THREE.Vector3((rnd() * 2 - 1) * 1.35 * vW, (rnd() * 2 - 1) * 1.35 * vH, -0.22 - 0.33 * rnd());
    const b = a.clone().add(vec(rnd() * 2 - 1, rnd() * 2 - 1, (rnd() * 2 - 1) * 0.2, 0.1 + 0.25 * rnd()));
    const mid = a.clone().add(b).multiplyScalar(0.5)
      .add(vec(rnd() - 0.5, rnd() - 0.5, (rnd() - 0.5) * 0.3, 0.03 + 0.04 * rnd()));
    const phase = rnd(), bright = 0.35 + 0.4 * rnd(), grow = 0.55 + 0.45 * rnd();
    const jd = vec(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, 0.7);
    const S = 4;
    for (let s = 0; s < S; s++) {
      for (const tt of [s / S, (s + 1) / S]) {
        const u = 1 - tt;
        const p = new THREE.Vector3().addScaledVector(a, u * u).addScaledVector(mid, 2 * u * tt).addScaledVector(b, tt * tt);
        lp.push(p.x, p.y, p.z);
        lT.push(tt);
        lPh.push(phase);
        lCl.push(0);
        lGa.push(0);
        lBr.push(bright);
        lGr.push(grow);
        lJit.push(jd.x, jd.y, jd.z);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lp), 3));
  g.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(lT), 1));
  g.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(lPh), 1));
  g.setAttribute('aClass', new THREE.BufferAttribute(new Float32Array(lCl), 1));
  g.setAttribute('aGang', new THREE.BufferAttribute(new Float32Array(lGa), 1));
  g.setAttribute('aBright', new THREE.BufferAttribute(new Float32Array(lBr), 1));
  g.setAttribute('aGrow', new THREE.BufferAttribute(new Float32Array(lGr), 1));
  g.setAttribute('aJit', new THREE.BufferAttribute(new Float32Array(lJit), 3));
  return g;
}

function Orb({ stage = 'talking', lowPower = false, onReveal }: { stage?: VenusStage; lowPower?: boolean; onReveal?: (r: number) => void }) {
  const { camera, advance } = useThree();
  const invalidate = useThree((s) => s.invalidate);
  const [root, setRoot] = useState<THREE.Object3D | null>(null);

  // FRAME DRIVER. frameloop is ALWAYS 'demand' (see the Canvas), so this ticker is the only thing
  // that renders — which lets us both CAP the rate (uncapped 'always' follows the display, i.e. 120Hz
  // on a ProMotion iPhone, and this full-screen additive scene at native DPR pegs the GPU → the whole
  // phone thermally throttles) AND stop entirely off her tab. Keeping frameloop fixed at 'demand' also
  // means the Canvas never reconfigures on navigation (a crash vector we avoid).
  //   • Eve tab (lowPower false): ~30fps — she's the star, she performs.
  //   • Everywhere else (lowPower true): a short settle burst so she assembles even on a cold start
  //     straight onto another tab, then FREEZE — zero ongoing GPU. She holds her last frame as a
  //     static backdrop. (Her voice is gated to the Eve tab, so there is nothing to stay live for.)
  useEffect(() => {
    if (lowPower) {
      let n = 0;
      const id = setInterval(() => {
        invalidate();
        if (++n >= 24) clearInterval(id); // ~2s of settling at ~12fps, then frozen
      }, 80);
      return () => clearInterval(id);
    }
    const id = setInterval(() => {
      invalidate();
    }, 33);
    return () => clearInterval(id);
  }, [lowPower, invalidate]);

  // __DEV__ Lab hook (like the face scene's __venusRevealOverride): step simulated time from the
  // console — `__venusOrbStep(tSeconds)` advances one frame. Hidden/automated tabs get no rAF, so
  // this is how stills are captured deterministically (see VENUS_AVATAR.md "judge the morph live").
  // NOTE: advance()'s DELTA runs on real wall-clock time between calls — damped values (reveal,
  // uSpeak, the shape gate) need real waits interleaved between step bursts.
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

  // ── stage → reveal clock (0 = scattered dust, 1 = formed constellation) + talking flag ──
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

  // Speech drive: the SAME lip-sync pipeline as the face — jawOpen energy storms the network.
  const lipRef = useRef<VenusLipsync | null>(null);
  if (!lipRef.current) lipRef.current = createVenusLipsync();
  const lipTargets = useRef<VisemeWeights>({});

  // Continuous-motion clocks, integrated on delta (rate changes stay phase-continuous):
  // spin = the slow constellation rotation (paused while a shape object is showing);
  // crawl = the luminous energy front creeping through the limbs along the aGrow field;
  // bpm = the 80bpm musical beat (steady — NOT tied to speech) that surges the hue clocks.
  const spinRef = useRef(0);
  const crawlRef = useRef(0);
  const bpmRef = useRef(0);
  const hueRef = useRef({ net: 0, lim: 0.33, nuc: 0.66 });
  const tkRef = useRef(0); // damped talk gate (kept OUT of the lattice uniform — that one now carries the energy baseline)
  const voiceOverrideRef = useRef<number | null>(null); // __venusOrbVoice: fake jawOpen for stills
  // MINIMAL VOICE MODEL (Joe: "start minimal — just get a good response from the voice"):
  // ONE coupling. The conditioned envelope below drives the NUCLEUS ONLY (scale + flare +
  // tight halo). Nothing else in the scene reacts to speech — ambient life stays decoupled.
  // Judge the nucleus response live, tune, then add layers back ONE at a time.
  const envRef = useRef(0);
  const holdRef = useRef(0);
  const jawP1 = useRef(0);
  const jawP2 = useRef(0);
  const schmittRef = useRef({ on: false, frames: 0, hang: 0 });
  const speakMixRef = useRef(0);

  // SHAPE-MORPH state: bus requests are polled per frame; a transition dissolves the dots
  // (reveal dips), swaps their targets to the new silhouette, then re-forms. The gate dims the
  // whole constellation (mind) and the halos while a non-orb object is showing; uLead makes the
  // dots carry the drawing.
  const shapeRig = useRef<{
    latGeo: THREE.BufferGeometry;
    idx: number[];
    orbTargets: Float32Array;
    orbFaceY: Float32Array;
    shapeS: number; // object sampler scale — unlike the cloud, objects must FIT the viewport
    yMin: number;
    ySpan: number;
  } | null>(null);
  const shapeState = useRef({ seq: 0, showing: 'orb' as VenusOrbShape, pending: null as VenusOrbShape | null, gate: 0 });
  useEffect(() => {
    if (!__DEV__) return;
    const g = globalThis as {
      __venusOrbShape?: (s: VenusOrbShape) => void;
      __venusOrbDebug?: () => unknown;
      __venusOrbSpin?: (rad: number) => void;
    };
    g.__venusOrbShape = (s) => setVenusOrbShape(s);
    // set the spin angle directly — coverage must be verified as a SWEEP over rotation angles
    // (single-angle stills repeatedly passed while live rotation found the gaps)
    g.__venusOrbSpin = (rad: number) => {
      spinRef.current = rad % (Math.PI * 2);
    };
    // fake the voice signal (0..1 jawOpen) for deterministic stills — the real one needs live
    // audio through the lipsync analyser. Pass null to return to the live signal.
    (g as { __venusOrbVoice?: (v: number | null) => void }).__venusOrbVoice = (v) => {
      voiceOverrideRef.current = v;
    };
    // Dev-only introspection for the deterministic-stills workflow: the live shape-machine state
    // plus the bounding box of the face dots' CURRENT landing targets (cloud ≈ wide irregular box;
    // a flat object ≈ thin z). See docs/studio/VENUS_AVATAR.md.
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
      delete g.__venusOrbSpin;
      delete (g as { __venusOrbVoice?: unknown }).__venusOrbVoice;
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

    // (a) THE UNIFIED LATTICE — ambient background dots + the soma landing dots in ONE buffer.
    //     The face targets ARE the soma positions (stretched): dot skin = neuron field, so the
    //     tee/heart/bolt shape-morph system keeps working unchanged.
    const { lines: netGeo, nodes: nodeGeo, dust: dustGeo, somaPositions, yMin, ySpan } =
      bakeConnectome(ORB_R);

    // FRAMING: coverage comes from CONSTRUCTION, not stretching — the net is BUILT past the
    // screen diagonal in every direction (outer ganglia to ~2.2R, isotropic in azimuth), so no
    // rotation angle can show its end. One UNIFORM scale only adapts the whole organism to very
    // wide viewports (built xz reach must exceed ~1.1× the view half-diagonal).
    const diag = Math.sqrt(vW * vW + vH * vH);
    const s = Math.max(1, (1.1 * diag) / (ORB_R * 2.1));
    const sCore = s;
    const stretch = (geo: THREE.BufferGeometry) => {
      const a = geo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < a.count; i++) a.setXYZ(i, a.getX(i) * s, a.getY(i) * s, a.getZ(i) * s);
      a.needsUpdate = true;
    };
    stretch(netGeo);
    stretch(nodeGeo); // NOTE: nodeGeo shares its buffer with somaPositions — both now scaled
    stretch(dustGeo);
    const somaGeo = new THREE.BufferGeometry();
    // the lattice/shape-morph contract covers ONLY the inner 880 somas (outer reaches excluded)
    somaGeo.setAttribute('position', new THREE.BufferAttribute(somaPositions.slice(0, ORB_DOTS * 3), 3));
    bakeAurora(somaGeo);
    const { geometry: latGeo, faceCentroid } = bakeUnifiedLattice(somaGeo, { vW, vH }, new THREE.Matrix4());
    const latticeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uMorph: { value: 0 }, uReveal: { value: 0 }, uLead: { value: 0 },
        uSpinY: { value: 0 }, uTgtScale: { value: 0 },
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

    // SHAPE-MORPH rig: remember which lattice dots are hers (aIsFace) and their soma landing
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
      // unit shapes span ±1, so cap the sampler scale to 92% of the short half-extent
      const shapeS = Math.min(ORB_R * 1.15 * sCore, 0.92 * Math.min(vW, vH));
      shapeRig.current = { latGeo, idx, orbTargets, orbFaceY, shapeS, yMin: yMin * s, ySpan: ySpan * s };
    }

    // (b) the stream field — a volumetric shell of dots looping INTO the mind (the depth-feed).
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

    // (c) the constellation. Camera FIXED at +z → static planes inside orbGroup ARE billboards.
    //     (No group scale — the stretch is baked into the geometry; core meshes carry sCore.)
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
    const haloWide = new THREE.Mesh(new THREE.PlaneGeometry(ORB_R * 6.0 * sCore, ORB_R * 6.0 * sCore), haloWideMat);
    haloWide.position.z = -0.02;
    haloWide.renderOrder = 2; // the room glow — near-invisible at idle, pulses with her voice
    const haloTightMat = haloMat(dotTex, CYAN);
    const haloTight = new THREE.Mesh(new THREE.PlaneGeometry(ORB_R * 1.1 * sCore, ORB_R * 1.1 * sCore), haloTightMat);
    haloTight.position.z = -0.01;
    haloTight.renderOrder = 3; // the nucleus bleed — hot air around the core, NOT a limb
    orbGroup.add(haloWide, haloTight);

    // THE MIND — dust, wiring and somas live in netGroup (bounded sway = cheap parallax).
    const netGroup = new THREE.Group();
    const dustMat = new THREE.ShaderMaterial({
      uniforms: {
        uDot: { value: dotTex }, uTime: { value: 0 }, uOpacity: { value: 0 },
        uOrbR: { value: ORB_R }, uExpand: { value: 0 },
        uColA: { value: new THREE.Color(NET_A) }, uColB: { value: new THREE.Color(NET_B) },
        uColMix: { value: 0 }, uBeatPop: { value: 0 },
      },
      vertexShader: DUST_VERT, fragmentShader: DUST_FRAG,
      transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const dustPts = new THREE.Points(dustGeo, dustMat);
    dustPts.renderOrder = 4;
    dustPts.frustumCulled = false;

    const wireUniforms = () => ({
      uTime: { value: 0 }, uOpacity: { value: 0 }, uRate: { value: 0.16 }, uFire: { value: 0.6 },
      uTalk: { value: 0 }, uSpeak: { value: 0 }, uGrow: { value: 0 }, uIgnite: { value: 0 },
      uTrunk: { value: 0 }, uHotGang: { value: 1 }, uGangFlare: { value: 0 },
      uOrbR: { value: ORB_R }, uCrawlPos: { value: 0 }, uExpand: { value: 0 },
      uYMin: { value: yMin * s }, uYSpan: { value: ySpan * s },
      uColA: { value: new THREE.Color(NET_A) }, uColB: { value: new THREE.Color(NET_B) },
      uColMix: { value: 0 }, uBeatPop: { value: 0 },
      uPlatinum: { value: new THREE.Color(PLATINUM) },
    });
    const netMat = new THREE.ShaderMaterial({
      uniforms: {
        ...wireUniforms(),
        uJitAmp: { value: 1 },
        uLimA: { value: new THREE.Color(LIM_A) }, uLimB: { value: new THREE.Color(LIM_B) },
        uLimMix: { value: 0 },
      },
      vertexShader: NET_VERT, fragmentShader: NET_FRAG,
      transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const wiring = new THREE.LineSegments(netGeo, netMat);
    wiring.renderOrder = 5;
    wiring.frustumCulled = false;
    // the far web sits OUTSIDE netGroup (never rotates) but shares netMat — same color clocks
    const farWeb = new THREE.LineSegments(bakeFarWeb(vW, vH), netMat);
    farWeb.renderOrder = 4;
    farWeb.frustumCulled = false;
    orbGroup.add(farWeb);
    const nodeMat = new THREE.ShaderMaterial({
      uniforms: wireUniforms(),
      vertexShader: NODE_VERT, fragmentShader: NODE_FRAG,
      transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const somaPts = new THREE.Points(nodeGeo, nodeMat);
    somaPts.renderOrder = 8;
    somaPts.frustumCulled = false;
    netGroup.add(dustPts, wiring, somaPts);
    orbGroup.add(netGroup);

    // THE NUCLEUS — hero core (inverse-fresnel heart + 2-tap mottle) inside its plasma sheath.
    const nucleusMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uOpacity: { value: 0 }, uFlare: { value: 0 },
        uColA: { value: new THREE.Color(NUC_A) }, uColB: { value: new THREE.Color(NUC_B) },
        uColMix: { value: 0 }, uBeatPop: { value: 0 },
      },
      vertexShader: NUCLEUS_VERT, fragmentShader: NUCLEUS_FRAG,
      transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const nucleus = new THREE.Mesh(new THREE.IcosahedronGeometry(NUC_R * sCore, 3), nucleusMat);
    nucleus.renderOrder = 6;
    const sheathMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uAmp: { value: 0.14 }, uFlow: { value: 0.16 }, uOpacity: { value: 0 },
        uBoil: { value: 0.15 }, uBlip: { value: 1 }, uIgnite: { value: 0 },
        uColA: { value: new THREE.Color(SHE_A) }, uColB: { value: new THREE.Color(SHE_B) },
        uColMix: { value: 0 }, uBeatPop: { value: 0 },
        uPlatinum: { value: new THREE.Color(PLATINUM) }, uNavy: { value: new THREE.Color(NAVY) },
      },
      vertexShader: PLASMA_VERT, fragmentShader: SHEATH_FRAG,
      side: THREE.FrontSide,
      transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const sheath = new THREE.Mesh(new THREE.SphereGeometry(SHEATH_R * sCore, 40, 28), sheathMat);
    sheath.renderOrder = 7;
    orbGroup.add(nucleus, sheath);
    scene.add(orbGroup);

    rig.current = {
      latticeMat, streamMat, sheathMat, nucleusMat, nucleus, netMat, nodeMat, dustMat, netGroup,
      haloTightMat, haloWideMat, orbGroup,
    };
    setRoot(scene);
    // camera never changes after this; the build is aspect-dependent, so rebuild if it did.
  }, [camera]);

  // NATIVE PRESENT GUARD — take over the render step. On expo-gl a frame only reaches the screen
  // when gl.endFrameEXP() is called after drawing. R3F v9's native Canvas patches gl.render to do
  // that, but its dep-less configure() re-runs on every Canvas re-render and can lose the patch —
  // frames then render into the buffer and are never presented. A priority>0 subscriber sets
  // internal.priority, which disables R3F's auto-render, so this is the ONLY render per frame.
  // The fingerprint keeps presents single: if gl.render is still the patched closure we captured
  // at first frame, it presents internally; if anything replaced it, we present explicitly.
  const present = useRef<{ fingerprint: unknown; ctx: { endFrameEXP?: () => void } | null }>({ fingerprint: null, ctx: null });
  useFrame((st) => {
    const gl = st.gl as unknown as { render: (s: THREE.Scene, c: THREE.Camera) => void; getContext?: () => { endFrameEXP?: () => void } };
    if (present.current.fingerprint === null) {
      present.current.fingerprint = gl.render; // the (possibly patched) render at first frame
      present.current.ctx = gl.getContext ? gl.getContext() : null;
    }
    st.gl.render(st.scene, st.camera);
    // R3F's own patch presents; only present ourselves when that patch is gone (or never worked
    // because the context predates it — endFrameEXP is a no-op on web, so this is native-only).
    if (gl.render !== present.current.fingerprint) present.current.ctx?.endFrameEXP?.();
  }, 1);

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

    // speech energy — jawOpen from the shared driver; the network's "voice" signal.
    const lip = lipRef.current;
    const talking = talkingRef.current || (lip?.speaking?.() ?? false);
    lipTargets.current = talking && lip ? lip.sample() : {};
    const speak = voiceOverrideRef.current ?? lipTargets.current.jawOpen ?? 0;
    const talk = talkingRef.current ? 1 : 0;
    // STATE MODEL (Joe 2026-07-04): "the way talking looks should be how silence looks" — the
    // old talking ENERGY is now the BASELINE (en: 0.75 silent → 1 talking); the talking state
    // itself is the VOICE layer below (color + nucleus riding the audio).
    tkRef.current = THREE.MathUtils.damp(tkRef.current, talk, 5, delta);
    const en = 0.75 + 0.25 * tkRef.current;
    // Brightness model: silence already glows near-full; the voice punches it.
    const lit = 0.88 + 0.12 * en;
    const blip = Math.random() < 0.003 ? 0.82 : 1.0; // the ONE allowed instability (lattice + sheath rim)

    // lattice: ambient Skia look + the cyclone + the talking bottom→top wave (aFaceY = cloud height).
    const u = r.latticeMat.uniforms;
    const { selA, selB, fade } = motionSelect(t);
    u.uTime.value = t;
    u.uBlip.value = blip;
    u.uReveal.value = R;
    u.uMorph.value = seg(0.1, 0.62);
    u.uSelA.value = selA; u.uSelB.value = selB; u.uFade.value = fade;
    (u.uDrift.value as THREE.Vector2).set(t * 0.01, t * 0.006);
    u.uSpeak.value = THREE.MathUtils.damp(u.uSpeak.value, speak * 1.2, 8, delta);
    u.uTalk.value = THREE.MathUtils.damp(u.uTalk.value, en, 5, delta); // dots wave in silence too
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
        const pts = ss.pending === 'orb' ? sr.orbTargets : sampleShape(ss.pending, sr.idx.length, sr.shapeS);
        const tgt = sr.latGeo.getAttribute('aTarget') as THREE.BufferAttribute;
        const fy = sr.latGeo.getAttribute('aFaceY') as THREE.BufferAttribute;
        sr.idx.forEach((li, k) => {
          tgt.setXYZ(li, pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2]);
          fy.setX(li, ss.pending === 'orb' ? sr.orbFaceY[k] : THREE.MathUtils.clamp((pts[k * 3 + 1] - sr.yMin) / sr.ySpan, 0, 1));
        });
        tgt.needsUpdate = true;
        fy.needsUpdate = true;
        ss.showing = ss.pending;
        ss.pending = null;
        revealTarget.current = 1; // …then cyclone onto the object
      }
    }
    // While a non-orb object is showing, the constellation steps back and the dots lead.
    ss.gate = THREE.MathUtils.damp(ss.gate, ss.showing !== 'orb' || ss.pending ? 1 : 0, 4, delta);
    const sphereDim = 1 - 0.97 * ss.gate; // halos — the round glow must go away entirely
    const mindDim = 1 - 0.88 * ss.gate;   // wiring/somas/dust/nucleus/sheath (a faint mind lingers)
    u.uLead.value = ss.gate;              // dots take over the drawing while an object shows

    // ── the constellation drive block (spec: docs/studio/VENUS_AVATAR.md orb v3) ─────
    const tk = tkRef.current; // damped stage-talking gate (rates/energy only — never a signal multiplier)
    // ── SPEECH CONDITIONING (researched retune — see VENUS_AVATAR.md "sound-wave" notes) ──
    // 1) median-of-3 despike: a 1-frame dropout in the jaw estimate can't reach the visuals.
    const j0 = speak;
    const med = Math.max(Math.min(j0, jawP1.current), Math.min(Math.max(j0, jawP1.current), jawP2.current));
    jawP2.current = jawP1.current;
    jawP1.current = j0;
    // 2) Schmitt gate (open 0.10 / close 0.04) + 2-frame debounce + 250ms hangover → a STATE.
    //    Consonants and audio-chunk gaps stay inside the hangover, so "speaking" never flickers.
    const sg = schmittRef.current;
    if (!sg.on) {
      sg.frames = med > 0.1 ? sg.frames + 1 : 0;
      if (sg.frames >= 2) { sg.on = true; sg.hang = 0.25; }
    } else if (med > 0.04) {
      sg.hang = 0.25;
    } else {
      sg.hang -= delta;
      if (sg.hang <= 0) { sg.on = false; sg.frames = 0; }
    }
    // 3) ONE asymmetric follower: attack τ=25ms (articulates every syllable), HOLD 150ms flat
    //    (bridges intra-word consonant dips), release τ=200ms. The follower IS the band-limit.
    const target = sg.on ? Math.min(med * 1.2, 1) : 0;
    if (target >= envRef.current) {
      envRef.current = THREE.MathUtils.damp(envRef.current, target, 40, delta);
      holdRef.current = 0.15;
    } else {
      holdRef.current -= delta;
      if (holdRef.current <= 0) envRef.current = THREE.MathUtils.damp(envRef.current, target, 5, delta);
    }
    const env = envRef.current;
    // beat-duck: while she speaks, the voice OWNS brightness — the 80bpm pop drops 22%→~3%.
    // Driven by the Schmitt STATE (not raw env) so the duck itself can't flicker.
    speakMixRef.current = THREE.MathUtils.damp(speakMixRef.current, sg.on ? 1 : 0, 6, delta);
    const growSweep = seg(0.48, 0.92);             // the network wires itself outward from the nucleus
    const ignite = seg(0.55, 0.8) * (1 - seg(0.8, 0.96)); // boot storm as she comes online

    const nm = r.netMat.uniforms, nd = r.nodeMat.uniforms;
    nm.uTime.value = t; nd.uTime.value = t;
    nm.uGrow.value = growSweep; nd.uGrow.value = growSweep;
    nm.uIgnite.value = ignite;
    nm.uRate.value = 0.16 + 0.12 * en; // ambient only — voice lives in the nucleus
    nd.uRate.value = nm.uRate.value;
    nm.uFire.value = 0.7;
    nd.uFire.value = nm.uFire.value;
    nm.uJitAmp.value = 1.0;
    nm.uTrunk.value = 0;
    nm.uTalk.value = en; nd.uTalk.value = en; // the band sweeps in silence too
    nm.uSpeak.value = 0; nd.uSpeak.value = 0; // wires fully decoupled from voice (minimal model)
    // idle cognition: every ~7s (faster while talking) ONE ganglion flares and decays — thinking.
    const per = 7 - 3 * en;
    const hot = Math.floor((t / per) % 7) + 1;
    const flare = Math.exp(-3 * ((t / per) % 1)) * (1 + 0.5 * en);
    nm.uHotGang.value = hot; nd.uHotGang.value = hot;
    nm.uGangFlare.value = flare; nd.uGangFlare.value = flare;
    nm.uOpacity.value = 0.9 * seg(0.5, 0.85) * lit * mindDim;
    nd.uOpacity.value = 1.0 * seg(0.45, 0.8) * lit * mindDim;
    r.dustMat.uniforms.uTime.value = t;
    r.dustMat.uniforms.uOpacity.value = 0.5 * seg(0.6, 0.95) * lit * mindDim;

    // ENERGY CRAWL — a luminous front creeping through the LIMBS along the BFS growth field
    // (nucleus → ganglia → arm tips, following actual wire paths). One lap ~12s at idle,
    // quicker while talking. Delta-integrated so rate changes stay phase-continuous.
    crawlRef.current = (crawlRef.current + delta * (0.08 + 0.04 * en)) % 1;
    nm.uCrawlPos.value = crawlRef.current;
    nd.uCrawlPos.value = crawlRef.current;
    // differential EXPANSION — the net grows outward like the universe: roots anchored, the
    // periphery drifting off the frame. The clock is SO slow (~2min period) that within any
    // viewing window it reads as one-way growth. (The uniform swell is dot-tracked; this isn't.)
    const expand = 0.06 + 0.06 * Math.sin(t * 0.05);
    nm.uExpand.value = expand;
    nd.uExpand.value = expand;
    r.dustMat.uniforms.uExpand.value = expand;

    // 80 BPM COLOR CLOCK — the heartbeat reborn as COLOR (art direction): a steady musical
    // pulse (80bpm, independent of speech). Each beat surges every part's OWN hue phase — net,
    // limbic and nucleus cycle their palettes at different rates — and pops brightness.
    bpmRef.current = (bpmRef.current + delta * (80 / 60)) % 1;
    const beatPop = Math.exp(-bpmRef.current * 6);
    // THE VOICE LAYER (the new talking representation): syllables SLIDE every hue clock and
    // shift the palettes in-shader (uVoice) — the organism's color visibly reacts to her voice.
    const hue = hueRef.current;
    hue.net = (hue.net + delta * beatPop * 0.3) % 1;
    hue.lim = (hue.lim + delta * beatPop * 0.45) % 1;
    hue.nuc = (hue.nuc + delta * beatPop * 0.22) % 1;
    nm.uColMix.value = hue.net;
    nd.uColMix.value = hue.net;
    r.dustMat.uniforms.uColMix.value = hue.net;
    nm.uLimMix.value = hue.lim;
    // BRIGHTNESS is the voice's channel while she speaks: the beat pop ducks 22%→~3% (state-driven)
    const beatDucked = beatPop * (1 - 0.85 * speakMixRef.current);
    nm.uBeatPop.value = beatDucked;
    nd.uBeatPop.value = beatDucked;
    r.dustMat.uniforms.uBeatPop.value = beatDucked;

    // nucleus + sheath — the mind condenses FIRST; the heart flares on syllables.
    const nu = r.nucleusMat.uniforms;
    nu.uTime.value = t;
    nu.uOpacity.value = (0.7 + 0.15 * Math.sin(t * 0.5)) * seg(0.42, 0.7) * lit * mindDim;
    nu.uFlare.value = 1.6 * env + 1.6 * ignite; // THE voice coupling — the heart IS her voice
    nu.uColMix.value = hue.nuc;
    nu.uBeatPop.value = beatDucked;
    r.nucleus.scale.setScalar(1.0 + 0.35 * env);      // swells with the envelope
    const sh = r.sheathMat.uniforms;
    sh.uTime.value = t;
    sh.uOpacity.value = 0.5 * seg(0.42, 0.7) * lit * mindDim;
    // LIQUID at rest — the sheath visibly flows and reshapes even in silence (art direction:
    // "plasma liquid… shapes flow in different ways"), and boils harder on speech.
    sh.uAmp.value = 0.14 + 0.02 * Math.sin(t * 0.5);
    sh.uFlow.value = 0.16;
    sh.uBoil.value = THREE.MathUtils.damp(sh.uBoil.value, 0.15 + 0.55 * en, 4, delta);
    sh.uBlip.value = blip;
    sh.uIgnite.value = ignite;
    sh.uColMix.value = hue.nuc; // the sheath rides the nucleus family's clock (own palette)
    sh.uBeatPop.value = beatDucked;

    // halos — nucleus bleed + the room pulse (the only round glows left; shape-gate kills them)
    r.haloTightMat.opacity = 0.3 * (1.0 + 1.1 * env) * lit * seg(0.5, 0.8) * sphereDim; // the glow blooms with her voice
    r.haloWideMat.opacity = 0.05 * seg(0.65, 0.95) * sphereDim;

    // ROTATION + BREATH — a slow continuous spin (full turn ~2min, quicker while talking) plus
    // the bounded sway and a long-period swell. The lattice shader rotates/swells the dot
    // LANDING TARGETS by the same uSpinY/uTgtScale, so landed dots stay glued to their somas
    // (this is what makes accumulating rotation safe). Spin pauses while an object is showing
    // so the tee/heart/bolt don't turn edge-on.
    spinRef.current = (spinRef.current + delta * (0.02 + 0.015 * tk) * (1 - ss.gate)) % (Math.PI * 2); // full turn ~5min — slow, per Joe
    const swell = 0.05 * Math.sin(t * 0.1);
    r.netGroup.rotation.y = Math.sin(t * 0.07) * 0.12 + spinRef.current;
    r.netGroup.rotation.x = Math.sin(t * 0.05 + 1.7) * 0.08;
    r.netGroup.scale.setScalar(1 + swell);
    u.uSpinY.value = r.netGroup.rotation.y;
    u.uTgtScale.value = swell;

    // the whole mind hovers — a slow bob, nothing humanoid.
    r.orbGroup.position.y = Math.sin(t * 0.5) * 0.006;
  });

  return root ? <primitive object={root} /> : null;
}

// Transparent canvas (the lattice IS the background), `stage` drives the lifecycle, `onReveal`
// reports assembly progress. `lowPower` sets the ambient render RATE (Orb's invalidate ticker), not
// whether she animates — she's always alive, just faster on her own tab.
//
// frameloop is ALWAYS 'demand' — Orb's ticker is the sole render driver, which (a) caps the rate
// (uncapped 'always' = the display's 120Hz on ProMotion → GPU thermal throttle) and (b) keeps the
// prop CONSTANT so the native Canvas never reconfigures the GL context on navigation (that churn is
// a crash vector). Do NOT switch frameloop at runtime; change the ticker rate instead.
export default function VenusOrbScene({ stage = 'talking', lowPower = false, onReveal }: { stage?: VenusStage; lowPower?: boolean; onReveal?: (r: number) => void }) {
  return (
    <Canvas
      camera={{ position: [0, 0, 2], fov: 22 }}
      style={{ flex: 1 }}
      gl={{ alpha: true }}
      frameloop="demand">
      <Orb stage={stage} lowPower={lowPower} onReveal={onReveal} />
    </Canvas>
  );
}

export type { VenusStage };
