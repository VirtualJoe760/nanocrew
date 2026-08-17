// Eve's mark, for the web. The geometry MIRRORS src/components/eve/eve-glyph.tsx (and
// scripts/gen-app-icon.mjs, which draws the app icon from the same arrays) so the invite page shows
// the same Eve the creator sees on their home screen. If the glyph changes, change it here too.

const NODES: [number, number][] = [[30, 32], [92, 26], [102, 64], [82, 98], [50, 104], [22, 82], [16, 48], [70, 18]];
const MIDS: [number, number][] = [[45, 46], [80, 52], [66, 82]];

export function EveGlyph({ size = 92 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden focusable="false">
      <defs>
        <radialGradient id="eve-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#7fd7e6" stopOpacity={0.5} />
          <stop offset="55%" stopColor="#7fd7e6" stopOpacity={0.15} />
          <stop offset="100%" stopColor="#7fd7e6" stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={60} cy={60} r={58} fill="url(#eve-glow)" />
      {NODES.map(([x, y], i) => (
        <line key={`l${i}`} x1={60} y1={60} x2={x} y2={y} stroke="#7fd7e6" strokeOpacity={0.62} strokeWidth={1.15} />
      ))}
      {NODES.map(([x, y], i) => (
        <circle key={`n${i}`} cx={x} cy={y} r={2.2} fill="#7fd7e6" fillOpacity={0.85} />
      ))}
      {MIDS.map(([x, y], i) => (
        <circle key={`m${i}`} cx={x} cy={y} r={1.54} fill="#7fd7e6" fillOpacity={0.6} />
      ))}
      <circle cx={60} cy={60} r={11} fill="#eaf4f9" fillOpacity={0.12} />
      <circle cx={60} cy={60} r={7} fill="#eaf4f9" />
      <circle cx={60} cy={60} r={11} fill="none" stroke="#7fd7e6" strokeWidth={1.15} strokeOpacity={0.7} />
    </svg>
  );
}

/** Her starfield — seeded, so the server and client render identical markup (no hydration drift). */
export function Starfield() {
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const stars = Array.from({ length: 110 }, (_, i) => ({
    key: i,
    cx: +(rnd() * 100).toFixed(2),
    cy: +(rnd() * 100).toFixed(2),
    r: +(0.04 + rnd() * 0.13).toFixed(3),
    o: +(0.08 + rnd() * 0.24).toFixed(2),
  }));
  return (
    <svg
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
      focusable="false">
      {stars.map((s) => (
        <circle key={s.key} cx={s.cx} cy={s.cy} r={s.r} fill="#7fd7e6" fillOpacity={s.o} />
      ))}
    </svg>
  );
}
