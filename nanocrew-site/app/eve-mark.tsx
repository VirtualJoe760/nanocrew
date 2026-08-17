// Eve's constellation — the site's logo, replacing the old serif "NC" box.
//
// The geometry is the SAME arrays as src/components/eve/eve-glyph.tsx and
// scripts/gen-app-icon.mjs, so the mark in the nav is literally the app icon. If the glyph
// changes there, change it here too.

const NODES: [number, number][] = [[30, 32], [92, 26], [102, 64], [82, 98], [50, 104], [22, 82], [16, 48], [70, 18]];
const MIDS: [number, number][] = [[45, 46], [80, 52], [66, 82]];

export function EveMark({ size = 34, glow = true }: { size?: number; glow?: boolean }) {
  const id = `eve-glow-${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      {glow ? (
        <defs>
          <radialGradient id={id} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--eve)" stopOpacity={0.4} />
            <stop offset="55%" stopColor="var(--eve)" stopOpacity={0.12} />
            <stop offset="100%" stopColor="var(--eve)" stopOpacity={0} />
          </radialGradient>
        </defs>
      ) : null}
      {glow ? <circle cx={60} cy={60} r={58} fill={`url(#${id})`} /> : null}
      {NODES.map(([x, y], i) => (
        <line key={`l${i}`} x1={60} y1={60} x2={x} y2={y} stroke="var(--eve)" strokeOpacity={0.62} strokeWidth={2.4} />
      ))}
      {NODES.map(([x, y], i) => (
        <circle key={`n${i}`} cx={x} cy={y} r={4.4} fill="var(--eve)" fillOpacity={0.85} />
      ))}
      {MIDS.map(([x, y], i) => (
        <circle key={`m${i}`} cx={x} cy={y} r={3} fill="var(--eve)" fillOpacity={0.6} />
      ))}
      <circle cx={60} cy={60} r={13} fill="#eaf4f9" fillOpacity={0.14} />
      <circle cx={60} cy={60} r={8} fill="#eaf4f9" />
      <circle cx={60} cy={60} r={13} fill="none" stroke="var(--eve)" strokeWidth={2.4} strokeOpacity={0.7} />
    </svg>
  );
}
