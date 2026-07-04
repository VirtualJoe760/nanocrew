import * as THREE from 'three';
import { HAIR_VERT, HAIR_FRAG, STRAND_VERT, STRAND_FRAG } from './venus-shaders';

// Procedural BOB hair for Venus — a bell-profile shell + flowing strand bristles.
// Extracted from venus-head-scene.tsx.
// Procedural BOB hair — the demo avatar only has long hair, so we build the bob
// ourselves: a stylized shell wrapping the head (covers the ears, fringe over the
// brow, A-line length), rendered as a translucent volume + glowing rim. These tune
// its shape relative to the head bounding box.
export const BOB_WIDEN = 1.0;       // shell width vs head half-width — hugs the head (was 1.07 → too wide /
                            // helmet). Just outside the scalp so it still occludes it; the opaque
                            // crown cap + depth-write keep the wireframe from showing through.
export const BOB_DEPTH = 1.06;      // shell depth vs head half-width (also outside the skull front/back)
export const BOB_FACE_OPEN = 0.82;  // half-width of the face opening (× head half-width) — matches the face
                            // clip (EAR_DROP_FRAC) so the hair frames the face AT its edge instead of
                            // draping a strand across the cheek/jaw (that strand read as a discolored
                            // layer over the face). Whole face now reads one cohesive colour.
export const BOB_FRINGE = 0.41;     // fringe ends this fraction of head height below the crown — shorter
                            // bangs, sitting a bit above the eyebrows.
export const BOB_LEN = -0.2;        // bob bottom (fraction of head height; negative = below the chin)
export const BOB_TILT = 0.65;       // A-line: front kept longer than the back (long-bob front pieces)
// Build the strand-bristle LineSegments that hug the same shape as the bob shell.
export function buildHairStrands(bb: THREE.Box3, eyeY: number): THREE.LineSegments {
  const cx = (bb.min.x + bb.max.x) / 2;
  const cz = (bb.min.z + bb.max.z) / 2;
  const w = bb.max.x - bb.min.x;
  const crownY = bb.max.y;
  const H = 2 * (crownY - eyeY);
  const chinY = crownY - H;
  const Rx = (w / 2) * BOB_WIDEN, Rz = (w / 2) * BOB_DEPTH;
  const prof = (hf: number) => {
    const dome = 0.34, jaw = 0.58;
    if (hf < dome) { const u = hf / dome; return 0.08 + 0.92 * Math.sqrt(Math.max(0, 1 - (1 - u) * (1 - u))); }
    if (hf < jaw) return 1;
    if (hf < 1) return 1 - 0.3 * ((hf - jaw) / (1 - jaw));
    return 0.7 - 0.18 * (hf - 1);
  };
  const faceHalfX = (w / 2) * BOB_FACE_OPEN;
  const browY = crownY - BOB_FRINGE * H;
  const jawY = chinY + BOB_LEN * H;
  const cut = (x: number, z: number) => jawY - BOB_TILT * (z - cz);

  const N = 1100, SEG = 18;
  const pos: number[] = [], aR: number[] = [], aPh: number[] = [];
  for (let i = 0; i < N; i++) {
    const ang = Math.random() * Math.PI * 2;
    const rootHf = 0.02 + Math.random() * 0.2;          // start near the crown/scalp
    const ph = Math.random() * Math.PI * 2;
    const wander = (Math.random() - 0.5) * 0.05;        // per-strand drift along its length
    const outJit = 1 + (Math.random() - 0.5) * 0.1;     // some strands stick out (flyaways)
    const maxHf = 1.0 + Math.random() * 0.5;            // tip length varies (uneven hem)
    let px = 0, py = 0, pz = 0, pt = 0, started = false;
    for (let j = 0; j <= SEG; j++) {
      const t = j / SEG;
      const hf = rootHf + t * (maxHf - rootHf);
      const y = crownY - hf * H;
      const r = prof(hf) * outJit;
      const a = ang + wander * t * 8.0;
      const x = cx + Rx * r * Math.cos(a);
      const z = cz + Rz * r * Math.sin(a);
      const inFace = z > cz && y < browY && Math.abs(x - cx) < faceHalfX; // no hair over the face
      if (inFace || y < cut(x, z)) break;                                  // strand ends here
      if (started) { pos.push(px, py, pz, x, y, z); aR.push(pt, t); aPh.push(ph, ph); }
      px = x; py = y; pz = z; pt = t; started = true;
    }
  }

  // a touch more strand texture ON THE BANGS (front fringe) — flow from the crown-front down to the
  // blunt brow line. Kept light ("not by much"): ~170 short strands that fade out at the fringe tip.
  const NB = 170;
  const fringeArc = faceHalfX * 1.15;
  for (let i = 0; i < NB; i++) {
    const ang = Math.PI * 0.5 + (Math.random() - 0.5) * 1.5; // front arc
    const ph = Math.random() * Math.PI * 2;
    const wander = (Math.random() - 0.5) * 0.04;
    const botHf = BOB_FRINGE + Math.random() * 0.03;         // ends ~at the brow (blunt fringe)
    let px = 0, py = 0, pz = 0, pt = 0, started = false;
    for (let j = 0; j <= SEG; j++) {
      const t = j / SEG;
      const hf = 0.02 + t * (botHf - 0.02);
      const y = crownY - hf * H;
      const r = prof(hf);
      const a = ang + wander * t * 6.0;
      const x = cx + Rx * r * Math.cos(a);
      const z = cz + Rz * r * Math.sin(a);
      if (z < cz || Math.abs(x - cx) > fringeArc) break;     // front fringe only
      if (started) { pos.push(px, py, pz, x, y, z); aR.push(pt, t); aPh.push(ph, ph); }
      px = x; py = y; pz = z; pt = t; started = true;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aRoot', new THREE.BufferAttribute(new Float32Array(aR), 1));
  g.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(aPh), 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uRoot: { value: new THREE.Color('#3a0f28') }, // deep plum root
      uTip: { value: new THREE.Color('#ff8fc8') },  // bright pink tip
      uTime: { value: 0 }, uWaveAmp: { value: 0.03 }, uWaveSpeed: { value: 1.2 }, uFade: { value: 0 },
    },
    vertexShader: STRAND_VERT,
    fragmentShader: STRAND_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });
  const lines = new THREE.LineSegments(g, mat);
  lines.frustumCulled = false;
  return lines;
}

// Build a stylized BOB hair shell — a BELL/HELMET profile (rounded crown that hugs
// the skull, then vertical side panels hanging straight down to the jaw), NOT a round
// ball. Carved for a face opening + A-line bottom; smooth fresnel-glow volume.
// `eyeY` (head-local) anchors the sizing to real proportions.
export function buildBobHair(bb: THREE.Box3, eyeY: number, topYCap?: number): THREE.Mesh {
  const cx = (bb.min.x + bb.max.x) / 2;
  const cz = (bb.min.z + bb.max.z) / 2;
  const w = bb.max.x - bb.min.x;            // head width (incl. ears)
  const crownY = bb.max.y;
  const H = 2 * (crownY - eyeY);            // head height (crown→chin); eyes ≈ halfway
  const chinY = crownY - H;
  const Rx = (w / 2) * BOB_WIDEN, Rz = (w / 2) * BOB_DEPTH;
  // The hair tops out a little above the bangs (topYCap), NOT at the crown — so it doesn't form the
  // full rounded dome over her head. Above it is just the faint substrate fibermesh.
  // Cap a little ABOVE the skull crown so the hair domes OVER the top of the head — the skull tip was
  // still poking through a "bald spot" at the very top. (topYCap, when given, still caps below.)
  const topY = topYCap !== undefined ? Math.min(crownY, topYCap) : crownY + 0.06 * H;
  const botY = chinY - 0.45 * H;            // grid extends well below the chin (long A-line front)
  const browY = crownY - BOB_FRINGE * H;    // fringe hangs to ~the brow
  const faceHalfX = (w / 2) * BOB_FACE_OPEN;
  const jawY = chinY + BOB_LEN * H;         // A-line bottom reference (tilt per-face)

  // profile radius (fraction of full width) vs HEAD-FRACTION hf (0 crown, 1 chin, >1 below):
  // rounded crown → full width over the ears → taper toward the jaw → hang below the chin.
  // (parameterizing by hf, not the row index, keeps proportions stable as the hair lengthens.)
  const hairTopHf = (crownY - topY) / H; // <= 0 when the cap domes ABOVE the crown
  const prof = (hf: number) => {
    const dome = 0.34, jaw = 0.58;
    // Hemisphere dome spanning from the RAISED top down to full width over the ears — mapping u from
    // the actual hair top (not the crown) avoids a narrow stalk/nub poking up at the very top.
    if (hf < dome) { const u = (hf - hairTopHf) / (dome - hairTopHf); return 0.05 + 0.95 * Math.sqrt(Math.max(0, 1 - (1 - u) * (1 - u))); }
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

  // ── CLOSE THE CROWN: a center pole + a fan to the top ring fills the hole at the very top of the
  //    shell. Without it the substrate skull shows through that hole as a "bald spot" — the world clip
  //    plane that was meant to hide the skull doesn't apply on the native GPU. DoubleSide → renders
  //    regardless of winding.
  {
    const topY2 = grid[0][0].y;
    const poleIdx = positions.length / 3;
    positions.push(cx, topY2, cz);
    aRoot.push(0);
    aAround.push(0);
    aEdge.push(topY2 - cutLine(new THREE.Vector3(cx, topY2, cz)));
    aFringe.push(0);
    aEdgeF.push(topY2 - browY);
    aFlow.push(0, -1, 0);
    for (let iu = 0; iu < cols; iu++) indices.push(poleIdx, vid(0, iu), vid(0, iu + 1));
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
      uRoot: { value: new THREE.Color('#2a0a1e') }, // dark plum root
      uTip: { value: new THREE.Color('#db6fae') },  // PINK hair (per Joe)
      uRim: { value: new THREE.Color('#ff9ed0') },  // bright pink rim glow
      uSpec1: { value: new THREE.Color('#ffe6f3') }, // primary sheen — light pink-white
      uSpec2: { value: new THREE.Color('#ff79bd') }, // secondary — pink glint
      uLightVS: { value: new THREE.Vector3(0.15, 0.55, 0.85).normalize() },
      uExp1: { value: 50.0 },
      uExp2: { value: 120.0 },
      uShift1: { value: -0.05 },
      uShift2: { value: 0.04 },
      uSpec1Str: { value: 0.6 },
      uSpec2Str: { value: 0.65 },
      uStrandCount: { value: 180.0 }, // finer bristle
      uStrandWander: { value: 8.0 },  // more lock-to-lock wander (less uniform)
      uTipFade: { value: 0.05 * H },
      uBaseAlpha: { value: 0.95 }, // near-opaque so the blue skull doesn't read THROUGH the crown
      uFade: { value: 0 },        // reveal fade (0 hidden → 1 full); the whole hair, rim included
      uTime: { value: 0 },
      uWaveAmp: { value: 0.022 },    // tip sway amplitude (metres) — gentle free-flow, not flailing
      uWaveSpeed: { value: 1.2 },    // wave speed
      uViewRot: { value: new THREE.Matrix3() },
    },
    vertexShader: HAIR_VERT,
    fragmentShader: HAIR_FRAG,
    transparent: true,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide, // show the INSIDE too, so waving strands don't cull/vanish
    depthWrite: true,
    // Pull the hair FORWARD in depth so it reliably occludes the coincident skull/substrate — on the
    // mobile GPU the head wireframe was z-fighting THROUGH the hair (the "see the top of her head"
    // bald spot). Lets us hug the head (BOB_WIDEN ~1.0) without the skull punching through.
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const bob = new THREE.Mesh(bobGeo, mat);
  bob.renderOrder = 0;
  return bob;
}
