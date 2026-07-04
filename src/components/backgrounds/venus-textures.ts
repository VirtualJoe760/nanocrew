import * as THREE from 'three';

// Procedural DataTexture / matcap makers for Venus (no DOM canvas → native-safe).
// Extracted from venus-head-scene.tsx.
// Soft round additive sprite — DataTexture (no DOM canvas → native-safe).
export function makeDotTexture(): THREE.Texture {
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
export function makeAuraTexture(): THREE.Texture {
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

// Baked "living hologram" SKIN matcap (DataTexture → native-safe): a stylized cyan lit-sphere
// (key + fill + ambient = form) with a WARM subsurface shift at the terminator — what makes skin read
// ALIVE (the DICE/GPU-Gems cheap-SSS idea) — and a fresnel rim at the silhouette. MeshMatcapMaterial
// samples it by the VIEW-SPACE NORMAL, so it shades with no lights, no UVs: ES2/expo-gl safe.
export function makeSkinMatcap(): THREE.Texture {
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  const nrm = (x: number, y: number, z: number) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l] as const; };
  const key = nrm(-0.35, 0.42, 0.84); // key light: upper-left, toward camera
  const fill = nrm(0.6, -0.15, 0.55); // soft fill: lower-right
  const cl = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const shadow = [0.04, 0.16, 0.22]; // deep cyan shadow
  const litC = [0.8, 0.97, 1.0];     // bright near-white cyan
  const warm = [1.0, 0.42, 0.3];     // subsurface warmth
  const rimC = [0.78, 0.98, 1.0];    // fresnel rim (cyan-white)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = ((x + 0.5) / S) * 2 - 1;
      const v = (1 - (y + 0.5) / S) * 2 - 1;
      const r2 = u * u + v * v;
      const i = (y * S + x) * 4;
      if (r2 >= 1) { data[i] = data[i + 1] = data[i + 2] = 4; data[i + 3] = 255; continue; }
      const nz = Math.sqrt(1 - r2);
      const nl = u * key[0] + v * key[1] + nz * key[2];
      const wrap = Math.pow(cl(nl * 0.5 + 0.5), 1.3); // wrapped/half-Lambert key — avoids a hard terminator
      const f = cl((u * fill[0] + v * fill[1] + nz * fill[2]) * 0.5 + 0.5) * 0.32; // soft fill
      const lum = cl(wrap + f);
      const term = Math.pow(cl(1 - nl), 2.0) * cl(nl * 0.5 + 0.72); // warm only in the wrap, not the core dark
      const fres = Math.pow(1 - nz, 3.0); // fresnel rim at the silhouette
      const col = [
        cl(lerp(shadow[0], litC[0], lum) + warm[0] * term * 0.5 + rimC[0] * fres * 0.7),
        cl(lerp(shadow[1], litC[1], lum) + warm[1] * term * 0.5 + rimC[1] * fres * 0.7),
        cl(lerp(shadow[2], litC[2], lum) + warm[2] * term * 0.5 + rimC[2] * fres * 0.7),
      ];
      data[i] = Math.round(col[0] * 255);
      data[i + 1] = Math.round(col[1] * 255);
      data[i + 2] = Math.round(col[2] * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
// An IRIS sprite texture — dark pupil, a bright limbal ring, striated cyan iris,
// and a catchlight. Additive: the alpha-0 pupil reads dark, so you SEE the iris.
export function makeIrisTexture(): THREE.Texture {
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
export const SCLERA_COLOR = '#dfeef3';
export function makeScleraTexture(): THREE.Texture {
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
