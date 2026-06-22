import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  createVenusLipsync,
  LIPSYNC_MORPHS,
  type VenusLipsync,
  type VisemeWeights,
} from '@/lib/venus-lipsync';

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
const EYE_R = 0.013; // eyeball radius — the iris sits this far from the eye centre

// The 4 morph-rigged meshes that make up the visible face (verified from the GLB).
const FACE_NAMES = ['Wolf3D_Head', 'EyeLeft', 'EyeRight', 'Wolf3D_Teeth'];
// The bright glow SHELL is built from the face SKIN only — eyeballs + teeth stay
// on the dim substrate (cleaner sockets, no bright eye-blobs; structure leads).
const SHELL_NAMES = ['Wolf3D_Head'];
// Procedural BOB hair — the demo avatar only has long hair, so we build the bob
// ourselves: a stylized shell wrapping the head (covers the ears, fringe over the
// brow, A-line length), rendered as a translucent volume + glowing rim. These tune
// its shape relative to the head bounding box.
const BOB_WIDEN = 1.0;       // shell width vs head half-width (hugs; covers ears)
const BOB_DEPTH = 1.12;      // shell depth vs head half-width
const BOB_FACE_OPEN = 0.6;   // half-width of the face opening (× head half-width)
const BOB_FRINGE = 0.44;     // fringe ends this fraction of head height below the crown (~brow)
const BOB_LEN = -0.2;        // bob bottom (fraction of head height; negative = below the chin)
const BOB_TILT = 0.65;       // A-line: front kept longer than the back (long-bob front pieces)
// Drop the outermost (ear) verts from the bright face shell (hidden under the bob).
const EAR_DROP_FRAC = 0.82;

// DEV: play a sample speech clip on load so the mouth moves (and the pulse reacts)
// on web. Set false for production / live Gemini audio. (Guarded to web.)
const DEV_LIPSYNC_TEST = true;
const DEV_SAMPLE_URL = 'https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg';

// ─── shaders (ES2-safe: precision mediump, no #version 300, no dynamic loops) ──
const NODE_VERT = /* glsl */ `
  precision mediump float;
  uniform float uTime, uPeriod, uSpeak;
  uniform float uReveal;      // 0 = scattered field, 1 = fully her
  uniform vec3  uCenter;      // face centroid (head-local) — vortex axis
  attribute float aY;         // baked normalized height 0..1
  attribute float aRand;      // baked per-node phase
  attribute vec3  aHome;      // scattered start (head-local)
  attribute float aDelay;     // staggers arrival (0..~0.55)
  varying vec3 vColor;
  varying float vGlow;
  mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
  void main() {
    // per-node staggered progress, eased
    float lp   = clamp((uReveal - aDelay) / max(1e-3, 1.0 - aDelay), 0.0, 1.0);
    float ease = lp * lp * (3.0 - 2.0 * lp);
    float land = smoothstep(0.78, 1.0, lp);          // "click into place" gate

    // travel home → target, with a VORTEX that resolves to 0 exactly on landing
    vec3 p = mix(aHome, position, ease);
    float spin = sin(ease * 3.14159);                // 0 → 1 → 0 over the flight
    float dirS = aRand < 0.5 ? -1.0 : 1.0;           // mostly-shared sense → coherent swirl
    float ang  = 7.0 * spin * dirS + uTime * (1.0 - ease) * 1.2;
    p.xz = rot(ang) * (p.xz - uCenter.xz) + uCenter.xz;
    p.y += spin * 0.10 * (aRand - 0.5);              // slight tornado updraft, gone on land

    // thought-pulse (UNCHANGED math; gated so it lights only once landed)
    float wave  = fract(uTime / uPeriod);
    float d     = aY - wave;
    float pulse = exp(-d * d * 140.0);
    float w2    = fract(uTime / 9.0 + 0.5);
    pulse += 0.5 * exp(-(aY - w2) * (aY - w2) * 60.0);
    float tw    = 0.9 + 0.1 * sin(uTime * 2.0 + aRand * 6.2831);
    vGlow = (0.5 + (1.5 + uSpeak) * pulse * land) * tw;

    vColor = mix(vec3(0.85, 0.95, 1.0), color, ease); // hot-white spark → aurora color
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float flight = 1.0 + (1.0 - ease) * 0.8 * spin;   // bigger/brighter mid-flight
    gl_PointSize = clamp(6.0 * vGlow * flight * (1.0 / -mv.z), 3.0, 16.0);
    gl_Position  = projectionMatrix * mv;
  }
`;
const NODE_FRAG = /* glsl */ `
  precision mediump float;
  uniform sampler2D uDot;
  uniform float uBlip;
  varying vec3 vColor;
  varying float vGlow;
  void main() {
    float a = texture2D(uDot, gl_PointCoord).a;
    gl_FragColor = vec4(vColor * vGlow * uBlip, a);  // additive → brightness = energy
  }
`;
const CORE_VERT = /* glsl */ `
  precision mediump float;
  varying vec3 vN, vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const CORE_FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vN, vV;
  void main() {
    float f = pow(max(dot(vV, vN), 0.0), 2.0);       // bright center, soft edge
    gl_FragColor = vec4(uColor * f, f * uOpacity);
  }
`;

type Rig = {
  meshes: THREE.Mesh[];
  bones: { head?: THREE.Object3D; neck?: THREE.Object3D; leftEye?: THREE.Object3D; rightEye?: THREE.Object3D };
  rest: Map<THREE.Object3D, THREE.Euler>;
  nodeMat?: THREE.ShaderMaterial;
  coreMat?: THREE.ShaderMaterial;
  edgeCoreMat?: THREE.LineBasicMaterial;
  edgeHaloMat?: THREE.LineBasicMaterial; // reveal fade
  glowMat?: THREE.PointsMaterial;        // node halo — reveal fade
  occluder?: THREE.Mesh;                 // dark face fill — reveal fade
  eyeObjs: THREE.Object3D[];             // iris/sclera sprites — hidden until formed
  cycleMats: THREE.Material[]; // edges — narrow hue drift
  aura?: THREE.Object3D;       // billboarded aura pool
  shell?: THREE.Group;
  bob?: THREE.Mesh;            // procedural bob (per-frame hair-shader uniforms)
  hairMat?: THREE.ShaderMaterial;
};

// Soft round additive sprite — DataTexture (no DOM canvas → native-safe).
function makeDotTexture(): THREE.Texture {
  const size = 64, cx = (size - 1) / 2;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / cx, dy = (y - cx) / cx;
      const a = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
      const v = Math.round(Math.pow(a, 2.2) * 255);
      const i = (y * size + x) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = v;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

// Radial aura gradient (cyan core → indigo → transparent).
function makeAuraTexture(): THREE.Texture {
  const size = 128, cx = (size - 1) / 2;
  const data = new Uint8Array(size * size * 4);
  const inner = new THREE.Color('#3FA6C8'), outer = new THREE.Color('#2E4A8C');
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / cx, dy = (y - cx) / cx;
      const r = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      const col = inner.clone().lerp(outer, r);
      const i = (y * size + x) * 4;
      data[i] = Math.round(col.r * 255);
      data[i + 1] = Math.round(col.g * 255);
      data[i + 2] = Math.round(col.b * 255);
      data[i + 3] = Math.round(Math.pow(Math.max(0, 1 - r), 1.6) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

// Merge named meshes into ONE position-only buffer baked into the head bone's
// local space, so a shell parented to Head registers perfectly and shares sway.
function bakeHeadLocal(scene: THREE.Object3D, head: THREE.Object3D, names: string[]): THREE.BufferGeometry | null {
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
function dropEars(geo: THREE.BufferGeometry, maxAbsX: number): THREE.BufferGeometry {
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

// Realistic stylized HAIR shader (Kajiya-Kay / Scheuermann dual anisotropic sheen +
// strand striations + root→tip gradient + soft tapered hem + blunt-fringe edge). The
// view-space hair TANGENT is derived from a baked object-space flow dir so the crown
// sheen band slides naturally as the head sways. ES2-safe (mediump, no loops/dFdx).
const HAIR_VERT = /* glsl */ `
  precision mediump float;
  attribute float aRoot;    // 0 crown → 1 tip
  attribute float aAround;  // 0..1 azimuth (strand index around the head)
  attribute float aEdge;    // metres above this vert's A-line cut (soft taper)
  attribute float aFringe;  // 1.0 = front blunt-fringe vert
  attribute float aEdgeF;   // metres above browY (fringe verts)
  attribute vec3  aFlow;    // OBJECT-space hair flow (≈ down-strand)
  uniform mat3 uViewRot;    // object→view rotation (per-frame)
  uniform float uTime, uWaveAmp, uWaveSpeed;
  varying vec3  vN, vV, vT;
  varying float vRoot, vAround, vEdge, vFringe, vEdgeF;
  void main() {
    // gentle wave — body tips sway (aRoot² anchors roots); the FRINGE flutters at its
    // bang-tips (anchored at the scalp, swaying where aEdgeF≈0 just above the eyes).
    float bodyAmt = aRoot * aRoot * uWaveAmp;
    float fringeAmt = uWaveAmp * 0.65 * smoothstep(0.08, 0.0, aEdgeF);
    float amt = mix(bodyAmt, fringeAmt, aFringe);
    vec3 wpos = position;
    wpos.x += sin(uTime * uWaveSpeed + aRoot * 7.0 + aAround * 11.0) * amt;
    wpos.z += cos(uTime * uWaveSpeed * 0.85 + aRoot * 6.0 + aAround * 9.0) * amt * 0.7;
    vec4 mv = modelViewMatrix * vec4(wpos, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    vec3 flowVS = normalize(uViewRot * aFlow);
    vec3 T = flowVS - vN * dot(flowVS, vN);
    if (dot(T, T) < 1e-4) T = cross(vN, vec3(1.0, 0.0, 0.0)); // crown-pole guard
    vT = normalize(T);
    vRoot = aRoot; vAround = aAround; vEdge = aEdge; vFringe = aFringe; vEdgeF = aEdgeF;
    gl_Position = projectionMatrix * mv;
  }
`;
const HAIR_FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3  uRoot, uTip, uRim, uSpec1, uSpec2, uLightVS;
  uniform float uExp1, uExp2, uShift1, uShift2, uSpec1Str, uSpec2Str;
  uniform float uStrandCount, uStrandWander, uTipFade, uBaseAlpha, uTime, uFade;
  varying vec3  vN, vV, vT;
  varying float vRoot, vAround, vEdge, vFringe, vEdgeF;
  float hash21(vec2 p){ p=fract(p*vec2(123.34,345.45)); p+=dot(p,p+34.345); return fract(p.x*p.y); }
  float vnoise(vec2 p){
    vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    float a=hash21(i), b=hash21(i+vec2(1.,0.)), c=hash21(i+vec2(0.,1.)), d=hash21(i+vec2(1.,1.));
    return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
  }
  vec3 shiftTangent(vec3 T, vec3 N, float s){ return normalize(T + s * N); }
  float strandSpec(vec3 T, vec3 V, vec3 L, float e){
    vec3 H = normalize(L + V); float th = dot(T, H);
    float s = sqrt(max(1.0 - th*th, 0.0));
    return smoothstep(-1.0, 0.0, th) * pow(s, e);
  }
  void main() {
    vec3 N = normalize(vN), V = normalize(vV), T = normalize(vT), L = normalize(uLightVS);
    float facing = gl_FrontFacing ? 1.0 : 0.0;
    if (facing < 0.5) N = -N; // backface = the INSIDE of the hair: flip so shading is sane
    // root→tip color + brightness
    float g = smoothstep(0.05, 1.0, vRoot);
    vec3 col = mix(uRoot, uTip, g);
    col += uTip * 0.35 * smoothstep(0.72, 1.0, vRoot);
    col *= mix(0.7, 1.0, smoothstep(0.0, 0.18, vRoot));
    // strand striations (emerge toward the tips, calmed at the silhouette)
    float wander = (vnoise(vec2(vAround*18.0, vRoot*2.0)) - 0.5) * uStrandWander;
    float bnd = pow(0.5 + 0.5*cos((vAround*uStrandCount + wander)*6.2831853), 1.6);
    float clump = vnoise(vec2(vAround*26.0, vRoot*3.0))*0.6 + vnoise(vec2(vAround*60.0, vRoot*8.0))*0.4;
    float strand = mix(0.82, 1.12, mix(bnd, clump, 0.35));
    float nv = max(dot(N, V), 0.0);
    strand = mix(1.0, strand, smoothstep(0.0, 0.4, nv));
    col *= mix(1.0, strand, g);
    // dual anisotropic Kajiya-Kay sheen
    float jit = (vnoise(vec2(vAround*uStrandCount, vRoot*4.0)) - 0.5) * 0.05;
    float s1 = strandSpec(shiftTangent(T, N, uShift1 + jit), V, L, uExp1) * uSpec1Str;
    float s2 = strandSpec(shiftTangent(T, N, uShift2 + jit), V, L, uExp2) * uSpec2Str;
    s2 *= mix(0.6, 1.4, hash21(floor(vec2(vAround*uStrandCount, vRoot*30.0)) + floor(uTime*6.0)));
    vec3 spec = uSpec1 * s1 + uSpec2 * s2;
    // fresnel rim (smoothed normals → clean falloff that hides facets) — subtle
    float f = pow(1.0 - nv, 2.6);
    col += spec + uRim * f * 0.5;
    // soft tapered A-line hem (feathered), but NOT on the blunt fringe
    float wisp = vnoise(vec2(vAround*uStrandCount*0.5, 7.0)) * uTipFade * 0.9;
    float taper = smoothstep(0.0, uTipFade, vEdge - wisp);
    float tipStrands = mix(1.0, smoothstep(0.35, 0.75, strand), 1.0 - taper);
    float fade = mix(taper, 1.0, vFringe);
    // crisp blunt-fringe cut line
    col += uTip * (1.0 - smoothstep(0.0, 0.012, vEdgeF)) * vFringe * 0.8;
    col *= mix(0.5, 1.0, facing); // the inside of the hair reads darker (but stays visible)
    float specLum = dot(spec, vec3(0.299, 0.587, 0.114));
    float alpha = (uBaseAlpha + 0.30 * f + specLum * 0.9) * fade * tipStrands * uFade;
    if (alpha < 0.12) discard;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

// Build a stylized BOB hair shell — a BELL/HELMET profile (rounded crown that hugs
// the skull, then vertical side panels hanging straight down to the jaw), NOT a round
// ball. Carved for a face opening + A-line bottom; smooth fresnel-glow volume.
// `eyeY` (head-local) anchors the sizing to real proportions.
function buildBobHair(bb: THREE.Box3, eyeY: number): THREE.Mesh {
  const cx = (bb.min.x + bb.max.x) / 2;
  const cz = (bb.min.z + bb.max.z) / 2;
  const w = bb.max.x - bb.min.x;            // head width (incl. ears)
  const crownY = bb.max.y;
  const H = 2 * (crownY - eyeY);            // head height (crown→chin); eyes ≈ halfway
  const chinY = crownY - H;
  const Rx = (w / 2) * BOB_WIDEN, Rz = (w / 2) * BOB_DEPTH;
  const topY = crownY;                      // the crown
  const botY = chinY - 0.45 * H;            // grid extends well below the chin (long A-line front)
  const browY = crownY - BOB_FRINGE * H;    // fringe hangs to ~the brow
  const faceHalfX = (w / 2) * BOB_FACE_OPEN;
  const jawY = chinY + BOB_LEN * H;         // A-line bottom reference (tilt per-face)

  // profile radius (fraction of full width) vs HEAD-FRACTION hf (0 crown, 1 chin, >1 below):
  // rounded crown → full width over the ears → taper toward the jaw → hang below the chin.
  // (parameterizing by hf, not the row index, keeps proportions stable as the hair lengthens.)
  const prof = (hf: number) => {
    const dome = 0.34, jaw = 0.58;
    if (hf < dome) return 0.08 + 0.92 * Math.sin((hf / dome) * Math.PI * 0.5); // round crown (no pole)
    if (hf < jaw) return 1;                                                    // full width over the ears
    if (hf < 1) return 1 - 0.3 * ((hf - jaw) / (1 - jaw));                     // taper toward the jaw
    return 0.7 - 0.18 * (hf - 1);                                              // hang below the chin
  };

  const segU = 96, segV = 96;                  // smoother + enough rows over the longer length
  const fringeRow = Math.round((browY - topY) / ((botY - topY) / segV)); // row where y ≈ browY
  const FRINGE_ARC = faceHalfX * 1.15;         // how wide across the front the fringe spans
  const grid: THREE.Vector3[][] = [];
  for (let iv = 0; iv <= segV; iv++) {
    const t = iv / segV;
    const y = topY - t * (topY - botY);
    const r = prof((crownY - y) / H);
    const row: THREE.Vector3[] = [];
    for (let iu = 0; iu <= segU; iu++) {
      const ang = (iu / segU) * Math.PI * 2;
      row.push(new THREE.Vector3(cx + Rx * r * Math.cos(ang), y, cz + Rz * r * Math.sin(ang)));
    }
    grid.push(row);
  }

  // ── shared vertices (one per grid node; last column reuses the first → seam welds) ──
  const cols = segU;
  const vid = (iv: number, iu: number) => iv * cols + (iu % cols);
  const positions: number[] = [];
  const aRoot: number[] = [], aAround: number[] = [], aEdge: number[] = [];
  const aFringe: number[] = [], aEdgeF: number[] = [], aFlow: number[] = [];
  const cutLine = (p: THREE.Vector3) => jawY - BOB_TILT * (p.z - cz);
  for (let iv = 0; iv <= segV; iv++) {
    for (let iu = 0; iu < cols; iu++) {
      const p = grid[iv][iu];
      positions.push(p.x, p.y, p.z);
      aRoot.push(iv / segV);
      aAround.push(iu / cols);
      aEdge.push(p.y - cutLine(p));
      aFringe.push(p.z > cz && Math.abs(p.x - cx) < FRINGE_ARC && iv <= fringeRow ? 1 : 0);
      aEdgeF.push(p.y - browY);
      const pn = grid[Math.min(iv + 1, segV)][iu]; // down-strand flow ≈ toward next row
      const fl = new THREE.Vector3(pn.x - p.x, pn.y - p.y, pn.z - p.z);
      if (fl.lengthSq() < 1e-8) fl.set(0, -1, 0);
      fl.normalize();
      aFlow.push(fl.x, fl.y, fl.z);
    }
  }

  // ── carve: emit indices only for kept quads (face opening / A-line / blunt fringe) ──
  const indices: number[] = [];
  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < cols; iu++) {
      const a = grid[iv][iu], b = grid[iv][iu + 1], c = grid[iv + 1][iu + 1], d = grid[iv + 1][iu];
      const mx = (a.x + b.x + c.x + d.x) / 4, my = (a.y + b.y + c.y + d.y) / 4, mz = (a.z + b.z + c.z + d.z) / 4;
      const isFrontBand = mz > cz && Math.abs(mx - cx) < FRINGE_ARC;
      let drop: boolean;
      if (isFrontBand) {
        drop = iv >= fringeRow;                                       // crisp horizontal blunt cut
      } else {
        const isFace = mz > cz && my < browY && Math.abs(mx - cx) < faceHalfX;
        const belowBottom = my < jawY - BOB_TILT * (mz - cz);
        drop = isFace || belowBottom;
      }
      if (drop) continue;
      indices.push(vid(iv, iu), vid(iv, iu + 1), vid(iv + 1, iu + 1), vid(iv, iu), vid(iv + 1, iu + 1), vid(iv + 1, iu));
    }
  }

  const bobGeo = new THREE.BufferGeometry();
  bobGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  bobGeo.setAttribute('aRoot', new THREE.BufferAttribute(new Float32Array(aRoot), 1));
  bobGeo.setAttribute('aAround', new THREE.BufferAttribute(new Float32Array(aAround), 1));
  bobGeo.setAttribute('aEdge', new THREE.BufferAttribute(new Float32Array(aEdge), 1));
  bobGeo.setAttribute('aFringe', new THREE.BufferAttribute(new Float32Array(aFringe), 1));
  bobGeo.setAttribute('aEdgeF', new THREE.BufferAttribute(new Float32Array(aEdgeF), 1));
  bobGeo.setAttribute('aFlow', new THREE.BufferAttribute(new Float32Array(aFlow), 3));
  bobGeo.setIndex(indices);
  bobGeo.computeVertexNormals(); // SMOOTH — shared verts + welded seam (kills facets)

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uRoot: { value: new THREE.Color('#06141b') },
      uTip: { value: new THREE.Color('#2f93a6') }, // medium teal hair (not neon cyan)
      uRim: { value: new THREE.Color('#4ab6c4') },
      uSpec1: { value: new THREE.Color('#bfeff7') }, // primary sheen — light cyan-white
      uSpec2: { value: new THREE.Color('#37c2c8') }, // secondary — teal glint
      uLightVS: { value: new THREE.Vector3(0.15, 0.55, 0.85).normalize() },
      uExp1: { value: 50.0 },
      uExp2: { value: 120.0 },
      uShift1: { value: -0.05 },
      uShift2: { value: 0.04 },
      uSpec1Str: { value: 0.6 },
      uSpec2Str: { value: 0.65 },
      uStrandCount: { value: 130.0 },
      uStrandWander: { value: 6.0 },
      uTipFade: { value: 0.05 * H },
      uBaseAlpha: { value: 0.5 }, // translucent → holographic like the rest of the mesh (sheen stays bright)
      uFade: { value: 0 },        // reveal fade (0 hidden → 1 full); the whole hair, rim included
      uTime: { value: 0 },
      uWaveAmp: { value: 0.02 },     // tip sway amplitude (metres)
      uWaveSpeed: { value: 1.1 },    // wave speed
      uViewRot: { value: new THREE.Matrix3() },
    },
    vertexShader: HAIR_VERT,
    fragmentShader: HAIR_FRAG,
    transparent: true,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide, // show the INSIDE too, so waving strands don't cull/vanish
    depthWrite: true,
  });
  const bob = new THREE.Mesh(bobGeo, mat);
  bob.renderOrder = 0;
  return bob;
}

// Bake the positional aurora gradient + height + per-node phase onto faceGeo.
function bakeAurora(geo: THREE.BufferGeometry) {
  geo.computeVertexNormals();
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const N = pos.count;
  const colA = new Float32Array(N * 3), aY = new Float32Array(N), aRand = new Float32Array(N);
  const bb = new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute);
  const span = Math.max(1e-6, bb.max.y - bb.min.y);
  const cyan = new THREE.Color('#5BD8E6'), peri = new THREE.Color('#7C9BF0');
  const viol = new THREE.Color('#B97CF2'), white = new THREE.Color('#CFF6FF');
  for (let i = 0; i < N; i++) {
    const y = (pos.getY(i) - bb.min.y) / span;
    aY[i] = y;
    aRand[i] = Math.random();
    const nz = Math.abs(nrm.getZ(i)); // 1 = front, 0 = grazing
    const c = cyan.clone();
    if (y > 0.62) c.lerp(viol, THREE.MathUtils.clamp((y - 0.62) / 0.38, 0, 1));
    else if (y > 0.32) c.lerp(peri, (y - 0.32) / 0.3);
    c.lerp(viol, (1 - nz) * 0.5);
    if (y > 0.9) c.lerp(white, (y - 0.9) / 0.1);
    colA[i * 3] = c.r; colA[i * 3 + 1] = c.g; colA[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colA, 3));
  geo.setAttribute('aY', new THREE.BufferAttribute(aY, 1));
  geo.setAttribute('aRand', new THREE.BufferAttribute(aRand, 1));
}

// Subsample a baked buffer (position + color + aY + aRand) at a fixed stride.
function subsample(geo: THREE.BufferGeometry, stride: number): THREE.BufferGeometry {
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

// Bake the REVEAL attributes onto the node geo: aHome (a scattered "swarm cloud" start
// position, head-local) + aDelay (per-node stagger). `position` is the TARGET face vertex.
// Call AFTER subsample, BEFORE building nodeMat. Returns the face centroid (the vortex axis).
function bakeAssemble(geo: THREE.BufferGeometry): THREE.Vector3 {
  geo.computeBoundingBox();
  const c = geo.boundingBox!.getCenter(new THREE.Vector3());
  const size = geo.boundingBox!.getSize(new THREE.Vector3());
  const pos = geo.attributes.position;
  const aYattr = geo.attributes.aY, rand = geo.attributes.aRand;
  const N = pos.count;
  const home = new Float32Array(N * 3);
  const delay = new Float32Array(N);
  const v = new THREE.Vector3();
  const rx = size.x * 3.2, ry = size.y * 2.8, rz = Math.max(size.z, size.y) * 2.6;
  for (let i = 0; i < N; i++) {
    // direction on a sphere, biased taller than wide → a column of dust, not a ball
    const u = Math.random() * 2 - 1, phi = Math.random() * Math.PI * 2;
    const sxy = Math.sqrt(1 - u * u);
    v.set(sxy * Math.cos(phi), sxy * Math.sin(phi) * 1.5, u);
    const shell = 0.8 + Math.random() * 0.3; // hollow band → collapses inward as a swarm
    home[i * 3] = c.x + v.x * rx * shell;
    home[i * 3 + 1] = c.y + v.y * ry * shell;
    home[i * 3 + 2] = c.z + v.z * rz * shell + rz * 0.3; // bias toward camera → flies "through" the viewer
    // stagger: chin→crown wipe blended with per-node randomness (reuse aY + aRand)
    const wipe = aYattr ? aYattr.getX(i) : Math.random(); // 0 chin … 1 crown
    const rnd = rand ? rand.getX(i) : Math.random();
    delay[i] = Math.min(0.55, 0.5 * (1 - wipe) + 0.25 * rnd);
  }
  geo.setAttribute('aHome', new THREE.BufferAttribute(home, 3));
  geo.setAttribute('aDelay', new THREE.BufferAttribute(delay, 1));
  return c;
}

// An IRIS sprite texture — dark pupil, a bright limbal ring, striated cyan iris,
// and a catchlight. Additive: the alpha-0 pupil reads dark, so you SEE the iris.
function makeIrisTexture(): THREE.Texture {
  const size = 64, c = (size - 1) / 2;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c, dy = (y - c) / c;
      const r = Math.sqrt(dx * dx + dy * dy);
      let a = 0, cr = 110, cg = 210, cb = 255; // cyan iris
      if (r < 0.30) a = 0;                                   // pupil — dark hole
      else if (r < 0.38) { a = 1; cr = 220; cg = 248; cb = 255; } // bright inner ring
      else if (r < 0.82) {
        const ang = Math.atan2(dy, dx);
        a = (0.7 + 0.3 * Math.sin(ang * 18)) * (1 - (r - 0.38) / 0.6); // striated iris
      } else a = 0;
      // catchlight — a small bright spot upper-left
      const cl = Math.max(0, 1 - Math.hypot(dx + 0.28, dy + 0.3) / 0.22);
      if (cl > 0) { a = Math.max(a, cl); cr = 255; cg = 255; cb = 255; }
      const i = (y * size + x) * 4;
      data[i] = cr; data[i + 1] = cg; data[i + 2] = cb;
      data[i + 3] = Math.round(Math.min(1, Math.max(0, a)) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

// The WHITE of the eye (sclera) — a soft almond RING (hole in the centre so the iris +
// dark pupil show through) so the eye reads as an eye. Color = SCLERA_COLOR.
const SCLERA_COLOR = '#dfeef3';
function makeScleraTexture(): THREE.Texture {
  const size = 64, c = (size - 1) / 2;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c, dy = (y - c) / c;
      const e = Math.sqrt(dx * dx + (dy * dy) / 0.42); // almond — wider than tall
      let a = Math.max(0, 1 - e);
      const h = Math.min(1, Math.max(0, (e - 0.34) / 0.22)); // hole in the centre for the iris
      a *= h * h * (3 - 2 * h);
      const i = (y * size + x) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
      data[i + 3] = Math.round(Math.pow(Math.min(1, a), 1.2) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

// An eye parented to an eye bone — a readable iris (ring + dark pupil + catchlight) over
// a faint halo + a SCLERA (eye-white), grouped at the origin so `useFrame` can AIM the whole
// eye at the camera (so she looks at the user, not off into space).
function makeIris(bone: THREE.Object3D | undefined, irisTex: THREE.Texture, scleraTex: THREE.Texture, dotTex: THREE.Texture, eyeObjs: THREE.Object3D[]): THREE.Material[] {
  if (!bone) return [];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3)); // at the group origin; the group is aimed each frame
  const scleraMat = new THREE.PointsMaterial({
    size: 0.058, map: scleraTex, color: new THREE.Color(SCLERA_COLOR), opacity: 0.75,
    transparent: true, sizeAttenuation: true, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: false,
  });
  const haloMat = new THREE.PointsMaterial({
    size: 0.016, map: dotTex, color: new THREE.Color('#2f6f8a'), opacity: 0.22,
    transparent: true, sizeAttenuation: true, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: false,
  });
  const irisMat = new THREE.PointsMaterial({
    size: 0.04, map: irisTex, color: new THREE.Color('#ffffff'),
    transparent: true, sizeAttenuation: true, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: false,
  });
  const sclera = new THREE.Points(g, scleraMat); sclera.renderOrder = 2;
  const halo = new THREE.Points(g, haloMat); halo.renderOrder = 3;
  const iris = new THREE.Points(g, irisMat); iris.renderOrder = 4;
  const eye = new THREE.Group();
  eye.add(sclera, halo, iris);
  eye.position.set(0, 0, EYE_R); // initial; useFrame re-aims it at the camera each frame
  eye.visible = false;           // reveal shows it once she's formed
  bone.add(eye);
  eyeObjs.push(eye);             // the group: aimed + visibility-gated in useFrame
  return [haloMat];
}

function Avatar({ url, reveal: revealProp = true }: { url: string; reveal?: boolean }) {
  const { camera, gl } = useThree();
  const [root, setRoot] = useState<THREE.Object3D | null>(null);
  const rig = useRef<Rig | null>(null);
  const a = useRef({ nextBlink: 1.2, blinkAt: -1, nextSacc: 0.6, gx: 0, gy: 0, nextBrow: 2.5, browAt: -1, browAmt: 0 });

  // ── reveal clock (0 = scattered dust-cloud, 1 = fully assembled) ───────────
  const reveal = useRef(0);
  const revealTarget = useRef(revealProp ? 1 : 0);
  useEffect(() => { revealTarget.current = revealProp ? 1 : 0; }, [revealProp]);
  // assemble from scratch each time she (re)loads — the dots-morph reveal
  useEffect(() => { if (root) { reveal.current = 0; revealTarget.current = revealProp ? 1 : 0; } }, [root]); // eslint-disable-line react-hooks/exhaustive-deps

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
    new GLTFLoader().load(
      url,
      (gltf) => {
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

        // ── build the glowing plexus shell ONCE (bind-pose; off the loop) ───
        const cycleMats: THREE.Material[] = [];
        const eyeObjs: THREE.Object3D[] = [];
        let shell: THREE.Group | undefined;
        let nodeMat: THREE.ShaderMaterial | undefined;
        let coreMat: THREE.ShaderMaterial | undefined;
        let edgeCoreMat: THREE.LineBasicMaterial | undefined;
        let edgeHaloMat: THREE.LineBasicMaterial | undefined;
        let glowMat: THREE.PointsMaterial | undefined;
        let occluder: THREE.Mesh | undefined;
        let aura: THREE.Object3D | undefined;
        let bob: THREE.Mesh | undefined;
        let hairMat: THREE.ShaderMaterial | undefined;
        let earClipX = 0; // |x| beyond which the dim substrate ears are clipped

        if (bones.head) {
          const dotTex = makeDotTexture();
          const irisTex = makeIrisTexture();
          const scleraTex = makeScleraTexture();
          const rawFace = bakeHeadLocal(gltf.scene, bones.head, SHELL_NAMES);
          if (rawFace) {
            rawFace.computeBoundingBox();
            const halfW = Math.max(Math.abs(rawFace.boundingBox!.min.x), Math.abs(rawFace.boundingBox!.max.x));
            earClipX = halfW * EAR_DROP_FRAC;
            const faceGeo = dropEars(rawFace, earClipX); // bright shell stops at the cheeks
            bakeAurora(faceGeo);
            const dotGeo = subsample(faceGeo, 3); // sparser, more deliberate nodes
            const fc = bakeAssemble(dotGeo); // reveal attrs (aHome/aDelay) + the vortex axis

            // (a) signature NODES — aurora gradient + thought-pulse + reveal/vortex morph
            nodeMat = new THREE.ShaderMaterial({
              uniforms: {
                uTime: { value: 0 },
                uPeriod: { value: 3.5 },
                uSpeak: { value: 0 },
                uBlip: { value: 1 },
                uDot: { value: dotTex },
                uReveal: { value: 0 },          // start scattered
                uCenter: { value: fc.clone() }, // face centroid = vortex axis
              },
              vertexShader: NODE_VERT,
              fragmentShader: NODE_FRAG,
              vertexColors: true,
              transparent: true,
              depthTest: true,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
            });
            const corePts = new THREE.Points(dotGeo, nodeMat);

            // (b) node halo — fake bloom, tighter so it reads clean (not washy)
            glowMat = new THREE.PointsMaterial({
              size: 0.034, map: dotTex, vertexColors: true, opacity: 0, // reveal fades it in
              transparent: true, sizeAttenuation: true,
              blending: THREE.AdditiveBlending, depthWrite: false,
            });
            const glowPts = new THREE.Points(dotGeo, glowMat);

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

            // (d) core glow — light from within (fresnel sphere behind the face; fc from bakeAssemble)
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
            coreSphere.position.set(fc.x, fc.y, fc.z - 0.03);
            coreSphere.renderOrder = 0;

            shell = new THREE.Group();
            shell.add(coreSphere, edgeHalo, glowPts, edgeCore, corePts); // back→front
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
              bob = buildBobHair(rawFace.boundingBox, e.y);
              hairMat = bob.material as THREE.ShaderMaterial;
              shell.add(bob);
            }

            // (f) glowing irises — expressive gaze that tracks the saccades
            cycleMats.push(...makeIris(bones.leftEye, irisTex, scleraTex, dotTex, eyeObjs));
            cycleMats.push(...makeIris(bones.rightEye, irisTex, scleraTex, dotTex, eyeObjs));

            bones.head.add(shell);
            cycleMats.push(edgeCoreMat, edgeHaloMat);

            // solid dark FILL of the face + neck (the "blackness") — also the depth
            // occluder: writes depth so hair BEHIND the face is hidden, front hair
            // (bangs/sides) covers the face, and flowing bottom strands still draw.
            // polygonOffset pushes its depth back so the (skinned) glowing wireframe
            // sits cleanly in front of it; the dark fill shows through the wire gaps.
            occluder = new THREE.Mesh(rawFace, new THREE.MeshBasicMaterial({
              color: new THREE.Color('#05090f'),
              transparent: true,
              opacity: 0, // reveal fades the dark fill in (depthWrite gated in useFrame)
              polygonOffset: true,
              polygonOffsetFactor: 4,
              polygonOffsetUnits: 4,
            }));
            occluder.renderOrder = -10;
            bones.head.add(occluder);

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

        rig.current = { meshes, bones, rest, nodeMat, coreMat, edgeCoreMat, edgeHaloMat, glowMat, occluder, eyeObjs, cycleMats, aura, shell, bob, hairMat };

        // frame the face off the known avatar scale (head at the top, face at +z).
        // NOTE: frame BEFORE adding the aura plane — it would inflate the bbox.
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const eyeY = box.max.y - 0.235;       // aim near the eyes/nose
        camera.position.set(0, eyeY, 0.99);   // portrait crop — whole head + the bob, eyes still read
        camera.lookAt(0, eyeY, 0);
        camera.updateProjectionMatrix();

        // clip the dim SUBSTRATE at the ear line so the ears don't poke out from under
        // the hair (the bright shell already dropped them; the bob covers the area).
        if (earClipX > 0) {
          gl.localClippingEnabled = true;
          const earPlanes = [
            new THREE.Plane(new THREE.Vector3(-1, 0, 0), earClipX), // keep x <= +earClipX
            new THREE.Plane(new THREE.Vector3(1, 0, 0), earClipX),  // keep x >= -earClipX
          ];
          for (const mm of meshes) {
            const mat = mm.material as THREE.Material;
            mat.clippingPlanes = earPlanes;
            mat.needsUpdate = true;
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
    const seg = (lo: number, hi: number) => { const x = THREE.MathUtils.clamp((R - lo) / (hi - lo), 0, 1); return x * x * (3 - 2 * x); };
    const alive = R > 0.6; // gate the human micro-life until she's formed

    // ── narrow hue drift (cyan→violet arc, ±14°, ~28s) — EDGES + hair only ──
    const h = 0.52 + 0.04 * Math.sin(t * 0.045);
    for (const m of r.cycleMats) (m as THREE.LineBasicMaterial).color?.setHSL(h, 0.5, 0.55);

    // ── rare holographic blip (the ONE instability) ────────────────────────
    const blip = Math.random() < 0.003 ? 0.82 : 1.0;

    // ── nodes: thought-pulse + speak energy + the reveal/vortex morph ───────
    const speak = lipTargets.current.jawOpen ?? 0;
    if (r.nodeMat) {
      const u = r.nodeMat.uniforms;
      u.uTime.value = t;
      u.uBlip.value = blip;
      u.uReveal.value = seg(0.1, 0.62); // gather → spin → stream → snap
      u.uSpeak.value = THREE.MathUtils.damp(u.uSpeak.value, speak * 1.2, 8, delta);
      u.uPeriod.value = THREE.MathUtils.damp(u.uPeriod.value, speak > 0.06 ? 1.4 : 3.5, 4, delta);
    }

    // ── structure layers fade in AFTER the nodes land (the choreography) ────
    if (r.glowMat) r.glowMat.opacity = 0.12 * seg(0.45, 0.66);
    if (r.edgeCoreMat) r.edgeCoreMat.opacity = 0.36 * seg(0.62, 0.78) * blip;
    if (r.edgeHaloMat) r.edgeHaloMat.opacity = 0.1 * seg(0.62, 0.78);
    const subA = 0.16 * seg(0.62, 0.78);
    for (const m of r.meshes) (m.material as THREE.MeshBasicMaterial).opacity = subA;
    if (r.coreMat) r.coreMat.uniforms.uOpacity.value = (0.5 + 0.1 * Math.sin(t * 0.5)) * seg(0.72, 0.9);
    if (r.occluder) {
      const om = r.occluder.material as THREE.MeshBasicMaterial;
      om.opacity = seg(0.5, 0.66);
      om.depthWrite = R > 0.5; // only occlude once the face forms (else it clips the cloud)
    }
    if (r.bob) r.bob.scale.setScalar(THREE.MathUtils.lerp(0.92, 1, seg(0.7, 0.9)));
    if (r.hairMat) r.hairMat.uniforms.uFade.value = seg(0.68, 0.92); // whole hair (rim incl.) fades in
    // ── eyes look AT the user (camera) with a gentle saccade drift (not a fixed stare) ──
    for (const eye of r.eyeObjs) {
      eye.visible = R > 0.66; // appear once she's formed (no floating eyes mid-cloud)
      const eb = eye.parent;
      if (!eb) continue;
      eb.getWorldPosition(_eyePos);
      _eyeTgt.copy(camera.position).add(_eyeDir.set(s.gx * 0.06, s.gy * 0.045, 0)); // drift AROUND the user
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
    // blink — eyelids close + open (0→1→0)
    if (s.blinkAt < 0 && t > s.nextBlink) s.blinkAt = t;
    let blink = 0;
    if (s.blinkAt >= 0) {
      const p = (t - s.blinkAt) / 0.14;
      if (p >= 1) {
        s.blinkAt = -1;
        s.nextBlink = t + 2 + Math.random() * 3.5;
      } else blink = Math.sin(p * Math.PI);
    }
    set('eyeBlinkLeft', blink);
    set('eyeBlinkRight', blink);

    // idle head + neck sway (from rest, mixed slow sines)
    sway(r.bones.head, Math.sin(t * 0.7) * 2 * DEG, Math.sin(t * 0.53) * 2.4 * DEG, Math.sin(t * 0.37) * 1 * DEG);
    sway(r.bones.neck, Math.sin(t * 0.7) * 1 * DEG, Math.sin(t * 0.53) * 1.2 * DEG, 0);

    // eye saccades — pick a new gaze drift every ~0.3-1.2s; the gaze itself is
    // aimed at the camera up top (so she looks at the user, drifting around them).
    if (t > s.nextSacc) {
      s.gx = (Math.random() - 0.5) * 2;
      s.gy = (Math.random() - 0.5) * 1.2;
      s.nextSacc = t + 0.3 + Math.random() * 0.9;
    }

    // brow micro-flashes over a faint baseline
    if (s.browAt < 0 && t > s.nextBrow) {
      s.browAt = t;
      s.browAmt = 0.15 + Math.random() * 0.2;
    }
    let brow = 0.04;
    if (s.browAt >= 0) {
      const p = (t - s.browAt) / 0.7;
      if (p >= 1) {
        s.browAt = -1;
        s.nextBrow = t + 3 + Math.random() * 5;
      } else brow = 0.04 + s.browAmt * Math.sin(p * Math.PI);
    }
    set('browInnerUp', brow);

    // faint resting smile (Mona-Lisa level)
    set('mouthSmileLeft', 0.1);
    set('mouthSmileRight', 0.1);

    // ── REAL audio → visemes (lip-sync owns ONLY jaw/mouth/viseme morphs) ───
    const lip = lipRef.current;
    if (lip) {
      const targets = lip.sample();
      // DEV fallback: when no real audio is driving (test clip autoplay/CORS-blocked, or
      // before Gemini is wired), drive a gentle SYNTHETIC "talk" so she visibly speaks.
      if (DEV_LIPSYNC_TEST && (lip.debug?.rms ?? 0) < 0.008) {
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
          const lambda = isJaw ? 16 : target > 0 ? 14 : 12;
          m.morphTargetInfluences[i] = THREE.MathUtils.damp(cur, target, lambda, delta);
        }
      }
    }
    } // end if (alive) — the human micro-life only runs once she's formed
  });

  return root ? <primitive object={root} /> : null;
}

// `reveal` drives the dots-morph: true = assemble from the dust-cloud, false = disperse.
// Wire it to the Studio brand create/edit flow later (e.g. reveal={isBuilding}).
export default function VenusHeadScene({ reveal = true }: { reveal?: boolean }) {
  return (
    <Canvas camera={{ position: [0, 0, 2], fov: 22 }} style={{ flex: 1 }}>
      <color attach="background" args={['#06080f']} />
      <Avatar url={AVATAR_URL} reveal={reveal} />
    </Canvas>
  );
}
