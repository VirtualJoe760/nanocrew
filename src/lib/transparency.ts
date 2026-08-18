import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

// Nano Banana can't emit true alpha — "transparent background" comes back as RENDERED
// checkerboard/white pixels, which would print on garments. Fix: we ask the model for a
// solid pure-magenta backdrop (rare in apparel art) and key it out to real alpha here.
// Pure-JS (pngjs/jpeg-js) because Metro can't bundle native addons like sharp.

function decode(input: Buffer): { data: Buffer; width: number; height: number } {
  // PNG magic: 89 50 4E 47 — anything else from Gemini is JPEG.
  if (input[0] === 0x89 && input[1] === 0x50) {
    const png = PNG.sync.read(input);
    return { data: png.data, width: png.width, height: png.height };
  }
  const img = jpeg.decode(input, { useTArray: true, maxMemoryUsageInMB: 1024 });
  return { data: Buffer.from(img.data), width: img.width, height: img.height };
}

/** Median border color of an image — the sampler keyOutMagenta keys against. */
function borderMedian(data: Buffer, width: number, height: number): [number, number, number] {
  const samples: number[][] = [];
  const ring = 3;
  for (let x = 0; x < width; x += 7) {
    for (const y of [ring, height - 1 - ring]) {
      const o = (y * width + x) * 4;
      samples.push([data[o], data[o + 1], data[o + 2]]);
    }
  }
  for (let y = 0; y < height; y += 7) {
    for (const x of [ring, width - 1 - ring]) {
      const o = (y * width + x) * 4;
      samples.push([data[o], data[o + 1], data[o + 2]]);
    }
  }
  const median = (idx: number) => {
    const vals = samples.map((s) => s[idx]).sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)];
  };
  return [median(0), median(1), median(2)];
}

/** Did the model actually obey the magenta-backdrop instruction? Callers use this to RETRY a
 *  generation before shipping an opaque tile as a brand's logo (recurring bug B5 — dark-palette
 *  brands got black backdrops and the key no-oped). Same test keyOutMagenta applies internally. */
export function borderLooksMagenta(input: Buffer): boolean {
  try {
    const { data, width, height } = decode(input);
    const [r, g, b] = borderMedian(data, width, height);
    return Math.min(r, b) - g > 40;
  } catch {
    return false;
  }
}

export async function keyOutMagenta(input: Buffer): Promise<Buffer> {
  const { data, width, height } = decode(input);

  // The model's "pure magenta" is never exactly #FF00FF — sample the border to learn the
  // ACTUAL background color, then key on distance to it.
  const [bgR, bgG, bgB] = borderMedian(data, width, height);

  // Only key if the border really is magenta-ish — otherwise this is a filled image and
  // we must not punch holes in it.
  const bgIsMagenta = Math.min(bgR, bgB) - bgG > 40;
  if (bgIsMagenta) {
    const NEAR = 70; // distance → fully transparent
    const FAR = 140; // distance → fully opaque
    for (let i = 0; i < width * height; i++) {
      const o = i * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
      if (dist < NEAR) {
        data[o + 3] = 0;
      } else if (dist < FAR) {
        const t = (dist - NEAR) / (FAR - NEAR); // 0..1 → opaque
        data[o + 3] = Math.round(data[o + 3] * t);
        // Kill the magenta cast on semi-transparent edge pixels.
        const cap = g + 25;
        if (r > cap) data[o] = cap;
        if (b > cap) data[o + 2] = cap;
      }
    }
  }

  // Auto-crop: the model centers art with big empty margins — trim to the art's bounding
  // box (plus a little breathing room) so the design FILLS its print file. Without this,
  // an 85%-width placement still looks tiny on the garment.
  if (bgIsMagenta) {
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 12) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX > minX && maxY > minY) {
      const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.03);
      minX = Math.max(0, minX - pad);
      minY = Math.max(0, minY - pad);
      maxX = Math.min(width - 1, maxX + pad);
      maxY = Math.min(height - 1, maxY + pad);
      const cw = maxX - minX + 1;
      const ch = maxY - minY + 1;
      const cropped = new PNG({ width: cw, height: ch });
      for (let y = 0; y < ch; y++) {
        data.copy(cropped.data, y * cw * 4, ((y + minY) * width + minX) * 4, ((y + minY) * width + maxX + 1) * 4);
      }
      return PNG.sync.write(cropped);
    }
  }

  const out = new PNG({ width, height });
  data.copy(out.data);
  return PNG.sync.write(out);
}

// Verification helper: are the corners actually transparent?
/** After keying: does the artwork read as a BOXED CARD — an opaque rectangle with its own
 *  background panel — instead of die-cut art? The chroma key can only remove magenta; when the
 *  model draws the subject ON a white/colored card, that card ships as a printed border (Joe's
 *  "huge no-no", 2026-08-17: the california-flag card). Heuristic: the opaque region's bounding
 *  box has a near-fully-opaque perimeter AND fills most of the canvas. */
export function looksBoxed(input: Buffer): boolean {
  try {
    const { data, width, height } = decode(input);
    let minX = width, minY = height, maxX = -1, maxY = -1, opaque = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 32) {
          opaque++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return false; // fully transparent — a different failure
    const boxW = maxX - minX + 1;
    const boxH = maxY - minY + 1;
    const boxFill = opaque / (boxW * boxH); // how solid the bounding box is
    // Perimeter opacity of the bounding box ring (inset 1px to dodge antialiasing).
    let edgeTotal = 0, edgeOpaque = 0;
    const test = (x: number, y: number) => {
      edgeTotal++;
      if (data[(y * width + x) * 4 + 3] > 32) edgeOpaque++;
    };
    for (let x = minX + 1; x < maxX; x += 2) { test(x, minY + 1); test(x, maxY - 1); }
    for (let y = minY + 1; y < maxY; y += 2) { test(minX + 1, y); test(maxX - 1, y); }
    const edgeRatio = edgeTotal ? edgeOpaque / edgeTotal : 0;
    return edgeRatio > 0.92 && boxFill > 0.9;
  } catch {
    return false;
  }
}

/** FEATHER (Joe, 2026-08-17, the skateboarding-bulldog): full-canvas art shouldn't hard-crop at
 *  its rectangle. Alpha fades over `radius`px approaching each canvas edge — a Photoshop-style
 *  edge feather. Die-cut art is untouched where it's already transparent (multiplied alpha). */
export function featherEdges(input: Buffer, radius?: number): Buffer {
  const png = PNG.sync.read(input);
  const { width, height, data } = png;
  // 5% read as 'didn't work' at phone scale (Joe) — 9% with a 24px floor is a visible feather.
  const r = Math.max(24, Math.round(radius ?? Math.min(width, height) * 0.09));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.min(x, y, width - 1 - x, height - 1 - y);
      if (d >= r) continue;
      const i = (y * width + x) * 4 + 3;
      // Smoothstep for a soft shoulder rather than a linear ramp.
      const t = d / r;
      const f = t * t * (3 - 2 * t);
      data[i] = Math.round(data[i] * f);
    }
  }
  return PNG.sync.write(png);
}

export function isTransparent(input: Buffer): boolean {
  const png = PNG.sync.read(input);
  const { data, width, height } = png;
  const alphaAt = (x: number, y: number) => data[(y * width + x) * 4 + 3];
  return [
    alphaAt(2, 2),
    alphaAt(width - 3, 2),
    alphaAt(2, height - 3),
    alphaAt(width - 3, height - 3),
  ].every((a) => a < 16);
}

// ---------------------------------------------------------------------------------------------
// normalizeArt — the POST-KEY quality pass for identity assets (logos/marks). Blind review of the
// first logo kits (2026-08-14) rejected every wordmark for the same measurable defect classes:
// dust-driven crops parking the art off-center, semi-opaque feather residue at canvas edges (full-
// width ghost lines, corner smudges), magenta RGB left under transparent pixels (pink bleed when
// anything resamples), and the asset's true shape never being measured. This pass is deterministic
// pixel work — no model, no retry roulette.

export type ArtShape = 'wide' | 'square' | 'lockup';

export type NormalizedArt = {
  buffer: Buffer;
  /** measured from the CLEANED art, not the prompt: wide ≥2.2 · square ≤1.35 · lockup between */
  shape: ArtShape;
  aspect: number;
};

export async function normalizeArt(input: Buffer): Promise<NormalizedArt> {
  const { data, width, height } = decode(input);

  // 1. Connected components over visible pixels (alpha>12), 4-neighbour flood fill.
  const N = width * height;
  const label = new Int32Array(N).fill(-1);
  const areas: number[] = [];
  const touchesEdge: boolean[] = [];
  const alphaSum: number[] = [];
  const stack = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    if (label[i] !== -1 || data[i * 4 + 3] <= 12) continue;
    const id = areas.length;
    let area = 0;
    let asum = 0;
    let edge = false;
    let sp = 0;
    stack[sp++] = i;
    label[i] = id;
    while (sp > 0) {
      const p = stack[--sp];
      const px = p % width;
      const py = (p / width) | 0;
      area++;
      asum += data[p * 4 + 3];
      if (px === 0 || py === 0 || px === width - 1 || py === height - 1) edge = true;
      for (const q of [p - 1, p + 1, p - width, p + width]) {
        if (q < 0 || q >= N || label[q] !== -1) continue;
        const qx = q % width;
        if ((q === p - 1 || q === p + 1) && Math.abs(qx - px) !== 1) continue; // no row wrap
        if (data[q * 4 + 3] > 12) {
          label[q] = id;
          stack[sp++] = q;
        }
      }
    }
    areas.push(area);
    alphaSum.push(asum);
    touchesEdge.push(edge);
  }
  if (!areas.length) return { buffer: input, shape: 'square', aspect: 1 };

  // 2. Decide what survives: the biggest component always; others must be ≥1% of its mass AND not
  //    be edge-touching feather residue (mean alpha < 200 = ghost line / smudge, not art).
  const main = areas.indexOf(Math.max(...areas));
  const keep = areas.map((a, id) => {
    if (id === main) return true;
    if (a < areas[main] * 0.01) return false;
    const meanAlpha = alphaSum[id] / a;
    if (touchesEdge[id] && meanAlpha < 200) return false;
    return true;
  });
  for (let i = 0; i < N; i++) {
    if (label[i] !== -1 && !keep[label[i]]) {
      data[i * 4 + 3] = 0;
    }
  }

  // 3. Neutralize RGB under fully transparent pixels to the art's mean opaque color — resamplers
  //    (Cloudinary c_fit, browser scaling) blend RGB from transparent neighbours, and leftover
  //    magenta was bleeding pink strokes into derived tiles.
  let rSum = 0, gSum = 0, bSum = 0, oCount = 0;
  for (let i = 0; i < N; i++) {
    if (data[i * 4 + 3] > 128) {
      rSum += data[i * 4]; gSum += data[i * 4 + 1]; bSum += data[i * 4 + 2]; oCount++;
    }
  }
  const mr = oCount ? Math.round(rSum / oCount) : 0;
  const mg = oCount ? Math.round(gSum / oCount) : 0;
  const mb = oCount ? Math.round(bSum / oCount) : 0;
  for (let i = 0; i < N; i++) {
    if (data[i * 4 + 3] === 0) {
      data[i * 4] = mr; data[i * 4 + 1] = mg; data[i * 4 + 2] = mb;
    }
  }

  // 4. Re-crop from SOLID pixels (alpha>40) so dust never drives geometry, with symmetric 8%
  //    padding — the asset is centered in its own file by construction.
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 40) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) return { buffer: input, shape: 'square', aspect: 1 };
  const aw = maxX - minX + 1;
  const ah = maxY - minY + 1;
  const pad = Math.round(Math.max(aw, ah) * 0.08);
  const cw = aw + pad * 2;
  const ch = ah + pad * 2;
  const out = new PNG({ width: cw, height: ch });
  // transparent matte carries the neutral RGB too
  for (let i = 0; i < cw * ch; i++) {
    out.data[i * 4] = mr; out.data[i * 4 + 1] = mg; out.data[i * 4 + 2] = mb; out.data[i * 4 + 3] = 0;
  }
  for (let y = 0; y < ah; y++) {
    const srcStart = ((y + minY) * width + minX) * 4;
    data.copy(out.data, ((y + pad) * cw + pad) * 4, srcStart, srcStart + aw * 4);
  }

  const aspect = aw / ah;
  const shape: ArtShape = aspect >= 2.2 ? 'wide' : aspect <= 1.35 ? 'square' : 'lockup';
  return { buffer: PNG.sync.write(out), shape, aspect: Math.round(aspect * 100) / 100 };
}
