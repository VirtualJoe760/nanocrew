import { Dimensions, StyleSheet, useColorScheme, View } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

// Shared Studio "chrome": the monochrome silk background, the NC brand mark, and the screen
// palette — so Studio, Design, Market, and Account all read as one product. (Extracted from
// studio.tsx; Studio imports these too, so the look stays in ONE place.)

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
    dim: dark ? '#adb0ba' : '#5f616a', // secondary text — brightened (was #9396a0) to lift off the dark bg
    faint: dark ? '#74767f' : '#9a9ba2', // tertiary text — brightened (was #56575e)
    accent: dark ? '#cdd1d9' : '#44474e',
    accent2: dark ? '#e8eaee' : '#2c2e34',
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

/** The Nano Crew "NC" brand mark — the real logo asset, tinted to the foreground.
 *  (`metallic` is accepted for back-compat with older callers but no longer used — the asset is flat.) */
export function NCMark({ size, color }: { size: number; color: string; metallic?: boolean }) {
  return (
    <Image
      source={require('../assets/brand/nc-mark.png')}
      style={{ width: size, height: size }}
      contentFit="contain"
      tintColor={color}
    />
  );
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
