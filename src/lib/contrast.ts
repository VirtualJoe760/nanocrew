// WCAG contrast math for DERIVED brand tokens. The creator's chosen palette is law and is never
// mutated (provision.ts writes it verbatim) — but pairings the TEMPLATES invent (button text on a
// primary fill) need a readable "on" color computed from the palette, or dark brands ship
// black-on-black CTAs (bug B9, 2026-08-14).

/** WCAG relative luminance of a #rrggbb hex (0 = black, 1 = white). */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const chan = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan((n >> 16) & 0xff) + 0.7152 * chan((n >> 8) & 0xff) + 0.0722 * chan(n & 0xff);
}

/** WCAG contrast ratio between two hexes (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Best readable color to sit ON `base`: prefers the first candidate clearing AA (4.5:1) so brand
 *  colors win when they work; falls back to whichever candidate contrasts most. */
export function bestOn(base: string, candidates: string[]): string {
  const pool = [...candidates, '#ffffff', '#0b0b0c'];
  for (const c of pool) if (contrastRatio(base, c) >= 4.5) return c;
  return pool.reduce((best, c) => (contrastRatio(base, c) > contrastRatio(base, best) ? c : best));
}
