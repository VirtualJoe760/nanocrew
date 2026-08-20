import { Dimensions, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { EveGlyph } from '@/components/eve/eve-glyph';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Shared app "chrome": the monochrome silk background, the brand mark (Eve's constellation
// glyph — the NC monogram is retired), and the screen palette — so Eve, Design, Market and
// Account all read as one product. The Eve page imports these too, so the look stays in ONE place.

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

export type Palette = ReturnType<typeof makePalette>;

export function makePalette(dark: boolean) {
  return {
    dark,
    bg: dark ? '#08080a' : '#f5f5f6',
    bgTop: dark ? '#141417' : '#fbfbfc',
    wave: dark
      ? ['#101013', '#0d0d10', '#131318', '#0b0b0e']
      : ['#eeeef0', '#e9e9ec', '#f0f0f2', '#e3e3e6'],
    ink: dark ? '#f4f4f6' : '#131316',
    dim: dark ? '#ebedf1' : '#3e4046', // secondary text — near-white on dark so it pops (no grey)
    faint: dark ? '#d2d4da' : '#6a6c73', // tertiary text — light silver, still a touch below dim
    accent: dark ? '#cdd1d9' : '#44474e',
    accent2: dark ? '#e8eaee' : '#2c2e34',
    // A cool, slightly-neon hue for input focus — distinct from the platinum button glow so a
    // focused field reads differently from a CTA. (Buttons = accent/platinum; inputs = accentCool.)
    accentCool: dark ? '#7cc7df' : '#2f7d8f',
    line: dark ? 'rgba(205,209,217,0.16)' : 'rgba(68,71,78,0.20)',
    coreInner: dark ? '#f4f4f6' : '#8a8d94',
  };
}

export function usePalette(): Palette {
  return makePalette(useColorScheme() !== 'light');
}

// ---------- Static silk background ----------

function wavePath(yBase: number, amp: number): string {
  const W = SCREEN_W;
  const H = SCREEN_H;
  return (
    `M0 ${yBase}` +
    ` C ${W * 0.28} ${yBase - amp}, ${W * 0.42} ${yBase + amp}, ${W * 0.56} ${yBase}` +
    ` C ${W * 0.72} ${yBase - amp}, ${W * 0.88} ${yBase + amp * 1.15}, ${W} ${yBase - amp * 0.35}` +
    ` L ${W} ${H} L 0 ${H} Z`
  );
}

const WAVES = [
  { y: SCREEN_H * 0.34, amp: 64, tone: 0, op: 0.9 },
  { y: SCREEN_H * 0.48, amp: 82, tone: 1, op: 0.85 },
  { y: SCREEN_H * 0.62, amp: 70, tone: 2, op: 0.9 },
  { y: SCREEN_H * 0.76, amp: 92, tone: 3, op: 0.85 },
  { y: SCREEN_H * 0.88, amp: 60, tone: 0, op: 0.95 },
];

export function FabricBackground({ p }: { p: Palette }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={SCREEN_W} height={SCREEN_H}>
        <Defs>
          <LinearGradient id="nc-wash" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={p.bgTop} />
            <Stop offset="1" stopColor={p.bg} />
          </LinearGradient>
          <RadialGradient id="nc-glow" cx="50%" cy="34%" r="52%">
            <Stop offset="0" stopColor={p.accent} stopOpacity={p.dark ? 0.12 : 0.07} />
            <Stop offset="1" stopColor={p.accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={SCREEN_W} height={SCREEN_H} fill="url(#nc-wash)" />
        {WAVES.map((w, i) => (
          <Path key={i} d={wavePath(w.y, w.amp)} fill={p.wave[w.tone]} opacity={w.op} />
        ))}
        <Rect width={SCREEN_W} height={SCREEN_H} fill="url(#nc-glow)" />
      </Svg>
    </View>
  );
}

/** The Nano Crew brand mark — Eve's constellation glyph (the CURRENT identity, 2026-08-16;
 *  the serif NC monogram is retired everywhere — assets/brand/README.md). `color`/`metallic`
 *  are accepted for back-compat with older callers but no longer used: the glyph carries its
 *  own identity color. */
export function NCMark({ size }: { size: number; color?: string; metallic?: boolean }) {
  return <EveGlyph size={size} />;
}

/** The standard page header: NC mark + an uppercase label (e.g. NC mark + "MARKET" reads "NC MARKET"). */
export function NCHeader({ label, p }: { label: string; p: Palette }) {
  return (
    <View style={ncStyles.header}>
      <NCMark size={22} color={p.ink} />
      <ThemedText type="code" style={[ncStyles.eyebrow, { color: p.dim }]}>
        {label}
      </ThemedText>
    </View>
  );
}

const ncStyles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.four, paddingTop: Spacing.three, paddingBottom: Spacing.two },
  eyebrow: { letterSpacing: 2, textTransform: 'uppercase' },
});
