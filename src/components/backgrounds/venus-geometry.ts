import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Geometry bake/derive helpers for Venus: head-local bake, ear/forehead carving, aurora colour
// bake, subsample, the UNIFIED LATTICE, and the stream field. Extracted from venus-head-scene.tsx.
// Merge named meshes into ONE position-only buffer baked into the head bone's
// local space, so a shell parented to Head registers perfectly and shares sway.
export function bakeHeadLocal(scene: THREE.Object3D, head: THREE.Object3D, names: string[]): THREE.BufferGeometry | null {
  scene.updateWorldMatrix(true, true);
  head.updateWorldMatrix(true, true);
  const headInv = new THREE.Matrix4().copy(head.matrixWorld).invert();
  const geos: THREE.BufferGeometry[] = [];
  for (const name of names) {
    const m = scene.getObjectByName(name) as THREE.Mesh | undefined;
    if (!m?.isMesh || !m.geometry) continue;
    const g = m.geometry.clone();
    for (const key of Object.keys(g.attributes)) if (key !== 'position') g.deleteAttribute(key);
    g.morphAttributes = {};
    m.updateWorldMatrix(true, false);
    g.applyMatrix4(m.matrixWorld);
    g.applyMatrix4(headInv);
    geos.push(g);
  }
  if (!geos.length) return null;
  const merged = mergeGeometries(geos, false);
  return merged ? mergeVertices(merged) : null;
}

// Drop triangles whose verts sit beyond |x| = maxAbsX (the ears) so the bright
// face shell stops at the cheeks and the hair reads as covering the ears.
export function dropEars(geo: THREE.BufferGeometry, maxAbsX: number): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const remap = new Int32Array(pos.count).fill(-1);
  const newPos: number[] = [];
  let nv = 0;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getX(i)) <= maxAbsX) { remap[i] = nv++; newPos.push(pos.getX(i), pos.getY(i), pos.getZ(i)); }
  }
  const newIdx: number[] = [];
  if (idx) {
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
      if (remap[a] >= 0 && remap[b] >= 0 && remap[c] >= 0) newIdx.push(remap[a], remap[b], remap[c]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(newPos), 3));
  if (idx) g.setIndex(newIdx);
  return g;
}

// Drop everything ABOVE yMax (the forehead/scalp) — the hair owns the head above the brow line, so
// the bright wireframe/dots only cover the face from ~the eyebrows down. Same vert-remap as dropEars.
export function dropAbove(geo: THREE.BufferGeometry, yMax: number): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const remap = new Int32Array(pos.count).fill(-1);
  const newPos: number[] = [];
  let nv = 0;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) <= yMax) { remap[i] = nv++; newPos.push(pos.getX(i), pos.getY(i), pos.getZ(i)); }
  }
  const newIdx: number[] = [];
  if (idx) {
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
      if (remap[a] >= 0 && remap[b] >= 0 && remap[c] >= 0) newIdx.push(remap[a], remap[b], remap[c]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(newPos), 3));
  if (idx) g.setIndex(newIdx);
  return g;
}
// Bake the (now consistent) face colour + height + per-node random onto faceGeo.
export function bakeAurora(geo: THREE.BufferGeometry) {
  const pos = geo.attributes.position;
  const N = pos.count;
  const colA = new Float32Array(N * 3), aY = new Float32Array(N), aRand = new Float32Array(N);
  const bb = new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute);
  const span = Math.max(1e-6, bb.max.y - bb.min.y);
  // CONSISTENT face colour — no height/grazing-normal gradient (the old cyan→periwinkle→violet by
  // height + a (1-nz)·0.5 violet shift on grazing faces is what discoloured the neck/sides vs the
  // front of the face). One cyan everywhere so the whole face reads as a single colour.
  const face = new THREE.Color('#5BD8E6');
  for (let i = 0; i < N; i++) {
    aY[i] = (pos.getY(i) - bb.min.y) / span; // still drives the speech wave + cyclone delay
    aRand[i] = Math.random();
    colA[i * 3] = face.r; colA[i * 3 + 1] = face.g; colA[i * 3 + 2] = face.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colA, 3));
  geo.setAttribute('aY', new THREE.BufferAttribute(aY, 1));
  geo.setAttribute('aRand', new THREE.BufferAttribute(aRand, 1));
}

// Subsample a baked buffer (position + color + aY + aRand) at a fixed stride.
export function subsample(geo: THREE.BufferGeometry, stride: number): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const col = geo.attributes.color, aY = geo.attributes.aY, aRand = geo.attributes.aRand;
  const n = Math.ceil(pos.count / stride);
  const p = new Float32Array(n * 3);
  const c = col ? new Float32Array(n * 3) : null;
  const y = aY ? new Float32Array(n) : null;
  const rnd = aRand ? new Float32Array(n) : null;
  for (let i = 0, j = 0; i < pos.count; i += stride, j++) {
    p[j * 3] = pos.getX(i); p[j * 3 + 1] = pos.getY(i); p[j * 3 + 2] = pos.getZ(i);
    if (c && col) { c[j * 3] = col.getX(i); c[j * 3 + 1] = col.getY(i); c[j * 3 + 2] = col.getZ(i); }
    if (y && aY) y[j] = aY.getX(i);
    if (rnd && aRand) rnd[j] = aRand.getX(i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  if (c) g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (y) g.setAttribute('aY', new THREE.BufferAttribute(y, 1));
  if (rnd) g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
  return g;
}

// Bake the REVEAL attributes onto the node geo: aHome now reads as the BACKGROUND dot
// GRID lifting off — a screen-facing lattice at the head's depth, spanning > the view,
// with light z + jitter — plus aDelay (stagger), aRadius/aSpan (the cyclone funnel).
// `position` is the TARGET face vertex. Returns the face centroid (= the funnel axis).
// ── THE UNIFIED LATTICE ───────────────────────────────────────────────────────
// ONE points buffer that IS the ambient background AND her face dots. Ambient dots
// (aIsFace=0) sit at a screen-filling grid doing the Skia dot-field look; a subset
// (aIsFace=1) is greedily tagged to the nearest grid cell of each face vertex — so her
// dots are LITERALLY background dots that PEEL UP and cyclone onto the exact face vertex
// (aTarget) on reveal, leaving a gap where they were. The residual stays a living
// background pulsing toward her. Lives in a scene-root group (world space), centered on
// the face's world position. (Replaces the old separate node grid — see venus-points.ts
// for the LATTICE shaders + the Skia-look port.)
export const LAT_COLS = 84, LAT_ROWS = 56; // 4704 dots; drop to 60×40 if a low-end device drops frames
export function bakeUnifiedLattice(
  faceDots: THREE.BufferGeometry,
  view: { vW: number; vH: number },
  headToGroup: THREE.Matrix4,
): { geometry: THREE.BufferGeometry; faceCentroid: THREE.Vector3 } {
  const fpos = faceDots.attributes.position;
  const fcol = faceDots.attributes.color;
  const faY = faceDots.attributes.aY;
  const M = fpos.count;

  // face vertices → GROUP (world) space + their centroid (= grid center AND funnel axis).
  const fv = new Float32Array(M * 3);
  const centroid = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  for (let k = 0; k < M; k++) {
    tmp.set(fpos.getX(k), fpos.getY(k), fpos.getZ(k)).applyMatrix4(headToGroup);
    fv[k * 3] = tmp.x; fv[k * 3 + 1] = tmp.y; fv[k * 3 + 2] = tmp.z;
    centroid.add(tmp);
  }
  centroid.multiplyScalar(1 / Math.max(1, M));

  const N = LAT_COLS * LAT_ROWS;
  const spanX = view.vW * 2.0, spanY = view.vH * 2.0; // fills the viewport, centered on her
  const maxR = Math.hypot(spanX, spanY) * 0.5;

  const home = new Float32Array(N * 3);
  const target = new Float32Array(N * 3);
  const cell = new Float32Array(N * 2);
  const col = new Float32Array(N * 3);
  const delay = new Float32Array(N);
  const radius = new Float32Array(N);
  const span = new Float32Array(N);
  const rand = new Float32Array(N);
  const isFace = new Float32Array(N);
  const dCenter = new Float32Array(N);
  const wipe = new Float32Array(N); // landed vertex aY (chin 0 … crown 1) for the delay stagger

  const BASE: [number, number, number] = [0.012, 0.013, 0.02]; // Skia near-black bed
  for (let i = 0; i < N; i++) {
    const gx = i % LAT_COLS, gy = Math.floor(i / LAT_COLS);
    const cellX = (gx + 0.5) / LAT_COLS - 0.5;
    const cellY = (gy + 0.5) / LAT_ROWS - 0.5;
    const hx = centroid.x + cellX * spanX;
    const hy = centroid.y + cellY * spanY;
    const hz = centroid.z + (Math.random() - 0.5) * 0.01; // tiny z-jitter → flight depth
    home[i * 3] = hx; home[i * 3 + 1] = hy; home[i * 3 + 2] = hz;
    target[i * 3] = hx; target[i * 3 + 1] = hy; target[i * 3 + 2] = hz; // ambient: target = home
    cell[i * 2] = gx - LAT_COLS / 2; cell[i * 2 + 1] = gy - LAT_ROWS / 2; // small ints (mediump-safe)
    col[i * 3] = BASE[0]; col[i * 3 + 1] = BASE[1]; col[i * 3 + 2] = BASE[2];
    rand[i] = Math.random();
    dCenter[i] = Math.hypot(cellX * spanX, cellY * spanY) / view.vH; // Skia vignette distance
    isFace[i] = 0; delay[i] = 0; radius[i] = 0; span[i] = 0; wipe[i] = 0;
  }

  // deterministic greedy tagging: face verts sorted (group-space y desc, x asc); each claims
  // the nearest UNCLAIMED grid cell by XY → her dots ARE real background dots.
  const order = Array.from({ length: M }, (_, k) => k).sort((a, b) => {
    const dy = fv[b * 3 + 1] - fv[a * 3 + 1];
    if (Math.abs(dy) > 1e-6) return dy;
    return fv[a * 3] - fv[b * 3];
  });
  const claimed = new Uint8Array(N);
  for (const k of order) {
    const vx = fv[k * 3], vy = fv[k * 3 + 1], vz = fv[k * 3 + 2];
    let best = -1, bestD = Infinity;
    for (let i = 0; i < N; i++) {
      if (claimed[i]) continue;
      const dx = home[i * 3] - vx, dy = home[i * 3 + 1] - vy;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) break;
    claimed[best] = 1;
    isFace[best] = 1;
    target[best * 3] = vx; target[best * 3 + 1] = vy; target[best * 3 + 2] = vz; // EXACT face vertex
    if (fcol) { col[best * 3] = fcol.getX(k); col[best * 3 + 1] = fcol.getY(k); col[best * 3 + 2] = fcol.getZ(k); }
    if (faY) wipe[best] = faY.getX(k);
  }

  // cyclone attrs for the tagged face dots (IDENTICAL recipe to the old bakeAssemble)
  for (let i = 0; i < N; i++) {
    if (!isFace[i]) continue;
    const dx = home[i * 3] - centroid.x, dz = home[i * 3 + 2] - centroid.z;
    const r = Math.hypot(dx, dz);
    radius[i] = r;
    span[i] = THREE.MathUtils.clamp(r / maxR, 0, 1);
    delay[i] = Math.min(0.55, 0.22 * (1 - wipe[i]) + 0.2 * span[i] + 0.13 * rand[i]);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(home.slice(), 3)); // for bbox/culling
  g.setAttribute('aHome', new THREE.BufferAttribute(home, 3));
  g.setAttribute('aTarget', new THREE.BufferAttribute(target, 3));
  g.setAttribute('aFaceY', new THREE.BufferAttribute(wipe, 1)); // face height → bottom-to-top speech wave
  g.setAttribute('aCell', new THREE.BufferAttribute(cell, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aDelay', new THREE.BufferAttribute(delay, 1));
  g.setAttribute('aRadius', new THREE.BufferAttribute(radius, 1));
  g.setAttribute('aSpan', new THREE.BufferAttribute(span, 1));
  g.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
  g.setAttribute('aIsFace', new THREE.BufferAttribute(isFace, 1));
  g.setAttribute('aDCenter', new THREE.BufferAttribute(dCenter, 1));
  return { geometry: g, faceCentroid: centroid };
}

// Build the persistent "stream" field: a hollow ellipsoidal shell of dots, each with an
// OUTER spawn (position) and an INNER sink (aInner, just at her surface), looping inward.
export function bakeStreamField(count: number, c: THREE.Vector3, size: THREE.Vector3): THREE.BufferGeometry {
  const pos = new Float32Array(count * 3);
  const inner = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const rand = new Float32Array(count);
  const yN = new Float32Array(count);
  const col = new Float32Array(count * 3);
  const rx = size.x * 3.6, ry = size.y * 3.2, rz = Math.max(size.z, size.y) * 3.0;
  const cyan = new THREE.Color('#5BD8E6'), peri = new THREE.Color('#7C9BF0'), viol = new THREE.Color('#B97CF2');
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1, p = Math.random() * Math.PI * 2;
    const sxy = Math.sqrt(1 - u * u);
    v.set(sxy * Math.cos(p), sxy * Math.sin(p) * 1.35, u);
    const shell = 0.78 + Math.random() * 0.42;
    pos[i * 3] = c.x + v.x * rx * shell;
    pos[i * 3 + 1] = c.y + v.y * ry * shell;
    pos[i * 3 + 2] = c.z + v.z * rz * shell + rz * 0.12;
    const su = Math.random() * 2 - 1, sp = Math.random() * Math.PI * 2;
    const ss = Math.sqrt(1 - su * su);
    inner[i * 3] = c.x + ss * Math.cos(sp) * size.x * 0.55;
    inner[i * 3 + 1] = c.y + ss * Math.sin(sp) * size.y * 0.6;
    inner[i * 3 + 2] = c.z + su * size.z * 0.5 + size.z * 0.2;
    phase[i] = Math.random();
    rand[i] = Math.random();
    const yy = THREE.MathUtils.clamp(0.5 + v.y * 0.7, 0, 1);
    yN[i] = yy;
    const cc = cyan.clone().lerp(peri, yy).lerp(viol, (1 - Math.abs(v.z)) * 0.5);
    col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aInner', new THREE.BufferAttribute(inner, 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  g.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
  g.setAttribute('aY', new THREE.BufferAttribute(yN, 1));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
