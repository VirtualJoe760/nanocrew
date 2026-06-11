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

export async function keyOutMagenta(input: Buffer): Promise<Buffer> {
  const { data, width, height } = decode(input);

  // The model's "pure magenta" is never exactly #FF00FF — sample the border to learn the
  // ACTUAL background color, then key on distance to it.
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
  const bgR = median(0);
  const bgG = median(1);
  const bgB = median(2);

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
