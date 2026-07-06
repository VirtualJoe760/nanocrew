import Svg, { Circle, Defs, Line, RadialGradient, Stop } from 'react-native-svg';

// EVE'S MARK — a small, STATIC neural-constellation glyph (no GL). Eve is the teal constellation
// entity now, so anywhere that used to show the old NC monogram orb (e.g. the signed-out "Meet Eve"
// gate) shows this instead — a nucleus with a few radiating dendrites, on brand and cheap.

const NET = '#7fd7e6';
const CORE = '#eaf4f9';

// Dendrite endpoints (in a 0..120 space, centered at 60,60) — a few branches at varied angles.
const NODES: [number, number][] = [
  [30, 32],
  [92, 26],
  [102, 64],
  [82, 98],
  [50, 104],
  [22, 82],
  [16, 48],
  [70, 18],
];
// A couple of mid-branch nodes for a little depth.
const MIDS: [number, number][] = [
  [45, 46],
  [80, 52],
  [66, 82],
];

export function EveGlyph({ size = 132 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120">
      <Defs>
        <RadialGradient id="eve-glow" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor={NET} stopOpacity={0.35} />
          <Stop offset="55%" stopColor={NET} stopOpacity={0.1} />
          <Stop offset="100%" stopColor={NET} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={60} cy={60} r={58} fill="url(#eve-glow)" />
      {/* dendrites */}
      {NODES.map(([x, y], i) => (
        <Line key={`l${i}`} x1={60} y1={60} x2={x} y2={y} stroke={NET} strokeOpacity={0.5} strokeWidth={1} />
      ))}
      {/* endpoint + mid nodes */}
      {NODES.map(([x, y], i) => (
        <Circle key={`n${i}`} cx={x} cy={y} r={2} fill={NET} fillOpacity={0.85} />
      ))}
      {MIDS.map(([x, y], i) => (
        <Circle key={`m${i}`} cx={x} cy={y} r={1.4} fill={NET} fillOpacity={0.6} />
      ))}
      {/* nucleus */}
      <Circle cx={60} cy={60} r={11} fill={CORE} fillOpacity={0.12} />
      <Circle cx={60} cy={60} r={7} fill={CORE} />
      <Circle cx={60} cy={60} r={11} fill="none" stroke={NET} strokeWidth={1} strokeOpacity={0.7} />
    </Svg>
  );
}
