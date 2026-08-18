import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

// MARKER ANNOTATIONS for region-targeted edits (Joe, 2026-08-18): Nano Banana takes no masks,
// but it follows VISUAL annotations well — so the creator circles a region with a marker tool,
// we bake the red strokes INTO the reference image here (pure JS — Metro can't bundle sharp),
// and the prompt tells the model to edit only the marked region and erase the marks.

export type MarkStroke = { x: number; y: number }[]; // normalized [0..1] image coords

const MARK_R = 255;
const MARK_G = 32;
const MARK_B = 32;

function decode(input: Buffer): { data: Buffer; width: number; height: number } {
  if (input[0] === 0x89 && input[1] === 0x50) {
    const png = PNG.sync.read(input);
    return { data: png.data, width: png.width, height: png.height };
  }
  const img = jpeg.decode(input, { useTArray: true, maxMemoryUsageInMB: 1024 });
  return { data: Buffer.from(img.data), width: img.width, height: img.height };
}

/** Stamp an opaque disc of marker colour. */
function stampDisc(data: Buffer, width: number, height: number, cx: number, cy: number, r: number) {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(width - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(height - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const i = (y * width + x) * 4;
      data[i] = MARK_R;
      data[i + 1] = MARK_G;
      data[i + 2] = MARK_B;
      data[i + 3] = 255;
    }
  }
}

/**
 * Bake marker strokes into an image (normalized polylines → red brush lines). Returns PNG.
 * Strokes are stamped as discs interpolated along each segment — a hand-marker look, cheap in JS.
 */
export function drawMarks(input: Buffer, strokes: MarkStroke[]): Buffer {
  const { data, width, height } = decode(input);
  const brush = Math.max(4, Math.round(Math.min(width, height) * 0.008));
  for (const stroke of strokes) {
    if (!stroke.length) continue;
    let prev = stroke[0];
    stampDisc(data, width, height, prev.x * width, prev.y * height, brush);
    for (let i = 1; i < stroke.length; i++) {
      const cur = stroke[i];
      const ax = prev.x * width;
      const ay = prev.y * height;
      const bx = cur.x * width;
      const by = cur.y * height;
      const dist = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(1, Math.ceil(dist / (brush * 0.6)));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        stampDisc(data, width, height, ax + (bx - ax) * t, ay + (by - ay) * t, brush);
      }
      prev = cur;
    }
  }
  const out = new PNG({ width, height });
  data.copy(out.data);
  return PNG.sync.write(out);
}

/** Validate the client-sent strokes payload (normalized, bounded). */
export function sanitizeMarks(raw: unknown): MarkStroke[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > 40) return null;
  const strokes: MarkStroke[] = [];
  for (const s of raw) {
    if (!Array.isArray(s) || s.length < 2 || s.length > 2000) continue;
    const pts: MarkStroke = [];
    for (const p of s) {
      const x = Number((p as { x?: unknown })?.x);
      const y = Number((p as { y?: unknown })?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      pts.push({ x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) });
    }
    if (pts.length >= 2) strokes.push(pts);
  }
  return strokes.length ? strokes : null;
}

/** The instruction wrapper that makes the model honor the marks — and erase them. */
export const MARKED_REGION_RULE =
  'The reference image contains hand-drawn RED MARKER annotations (bright red strokes/circles). They indicate the ONLY region(s) to change. Apply the requested edit strictly within the marked region(s) and keep everything outside them EXACTLY as in the reference. The red marker strokes themselves are annotations, NOT content — they must be completely absent from the output.';
