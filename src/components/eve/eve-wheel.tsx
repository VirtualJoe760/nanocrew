import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Eve's radial menu — the Xbox-style wheel that replaced the pull-down deck (Joe's design, signed
// off from the mock: docs/studio/EVE_CONTROL.md). Press-and-hold anywhere on her opens it; drag the
// thumb to a sector; release to choose. Releasing in the centre cancels and she carries on exactly
// as she was.
//
// Eight sectors on the cardinals and diagonals — 45° is the largest target you can hit without
// looking, which is the whole point: this is operated by feel, not by aim.
//
// This component OWNS NO STATE about Eve. It reports a chosen id and the parent decides; that keeps
// the "only a creator opens a socket" rule in one place (eve-home).

export type WheelId = 'toggle' | 'design' | 'site' | 'assets' | 'digest' | 'brand' | 'newbr' | 'type';

type Spoke = {
  id: WheelId;
  label: string;
  /** Drawn under the icon so the glyphs aren't a guessing game. Short enough not to collide with
   *  its neighbours — the hub carries the full phrasing when a sector is selected. */
  short: string;
  /** Degrees, 0 = right, clockwise. Matches the signed-off mock exactly. */
  deg: number;
  /** Path in a 16x16 box centred on 0,0. */
  icon: string;
  /** Brand-scoped: dimmed with a reason until the creator has a brand. */
  needsBrand?: boolean;
};

const SPOKES: Spoke[] = [
  { id: 'toggle', label: 'Talk to Eve', short: 'TALK', deg: -90, icon: 'M -5 -6 L 7 0 L -5 6 Z' },
  { id: 'design', label: 'New design', short: 'DESIGN', deg: -45, icon: 'M -6 6 L 2 -6 L 6 0' },
  { id: 'site', label: 'Edit site', short: 'SITE', deg: 0, icon: 'M -7 -5 h 14 v 10 h -14 z M -7 -1 h 14', needsBrand: true },
  { id: 'assets', label: 'Site assets', short: 'ASSETS', deg: 45, icon: 'M -7 -6 h 14 v 12 h -14 z M -7 4 L -1 -3 L 3 2 L 7 -2', needsBrand: true },
  { id: 'digest', label: 'Digest', short: 'DIGEST', deg: 90, icon: 'M -6 5 v -6 M 0 5 v -10 M 6 5 v -3', needsBrand: true },
  { id: 'brand', label: 'Brand info', short: 'BRAND', deg: 135, icon: 'M 0 -7 L 6 -3 v 8 L 0 8 L -6 5 v -8 Z', needsBrand: true },
  { id: 'newbr', label: 'New brand', short: 'NEW', deg: 180, icon: 'M 0 -7 v 14 M -7 0 h 14' },
  { id: 'type', label: 'Type instead', short: 'TYPE', deg: -135, icon: 'M -8 -5 h 16 v 10 h -16 z M -4 1 h 8' },
];

/**
 * Centre dead-zone radius. Inside it nothing is selected — releasing there cancels.
 * Deliberately NOT screen-relative: it's a measure of thumb travel from the press point, which
 * doesn't change with the phone. spokeAt() hit-tests against it, so it must stay a constant.
 */
export const WHEEL_DEAD_ZONE = 54;

/** Visual radius only. Bigger on bigger phones, but never so wide it can't clear the edges. */
function radiusFor(width: number, height: number): number {
  return Math.round(Math.min(172, Math.max(136, Math.min(width, height) * 0.38)));
}

/**
 * Which sector does this offset from the wheel's centre fall in?
 * Exported so the gesture (which lives with the parent, on the UI thread) and the render agree on
 * one definition instead of drifting apart.
 */
export function spokeAt(dx: number, dy: number): WheelId | null {
  if (Math.hypot(dx, dy) < WHEEL_DEAD_ZONE) return null;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI; // -180..180, 0 = right
  // Nearest of the eight, each owning ±22.5°.
  let best: Spoke = SPOKES[0];
  let bestDelta = 999;
  for (const s of SPOKES) {
    // Shortest angular distance between the drag heading and this spoke's heading.
    const d = Math.abs(((deg - s.deg + 540) % 360) - 180);
    if (d < bestDelta) {
      bestDelta = d;
      best = s;
    }
  }
  return best.id;
}

export function EveWheel({
  x,
  y,
  active,
  hasBrand,
  brandsKnown,
  talking,
  micDenied,
}: {
  /** Screen coords the hold began at — the wheel centres here, clamped to stay on screen. */
  x: number;
  y: number;
  /** Currently highlighted sector, or null when the thumb is in the dead zone. */
  active: WheelId | null;
  hasBrand: boolean;
  /**
   * Do we actually KNOW yet? `hasBrand` alone conflated three states — no brands, not loaded, and
   * load-failed — so a creator with six brands saw four dead spokes if they held before /api/me
   * answered, or forever if it errored. Never dim on ignorance: dim only once the answer is in.
   */
  brandsKnown: boolean;
  talking: boolean;
  micDenied?: boolean;
}) {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const RADIUS = radiusFor(width, height);
  const [lastActive, setLastActive] = useState<WheelId | null>(null);

  // A tick each time the highlight moves — this is what makes it feel like a physical dial.
  useEffect(() => {
    if (active === lastActive) return;
    setLastActive(active);
    if (active && Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [active, lastActive]);

  // Keep the whole wheel on screen even when the hold starts near an edge.
  const pad = RADIUS + Spacing.six;
  const cx = Math.min(Math.max(x, pad), width - pad);
  const cy = Math.min(Math.max(y, pad), height - pad);

  const scale = useSharedValue(0.86);
  useEffect(() => {
    scale.value = withSpring(1, { damping: 15, stiffness: 220 });
  }, [scale]);
  const pop = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const disabledFor = useMemo(
    () => (s: Spoke) => {
      if (s.id === 'toggle' && micDenied) return true;
      return !!s.needsBrand && brandsKnown && !hasBrand;
    },
    [hasBrand, brandsKnown, micDenied],
  );

  const activeSpoke = SPOKES.find((s) => s.id === active) ?? null;
  const activeDisabled = activeSpoke ? disabledFor(activeSpoke) : false;
  const caption = activeSpoke
    ? activeDisabled
      ? activeSpoke.id === 'toggle'
        ? 'Can’t hear you — type instead'
        : 'After your first brand'
      : activeSpoke.id === 'toggle'
        ? talking
          ? 'Stop talking'
          : 'Talk to Eve'
        : activeSpoke.label
    : 'Release to cancel';

  return (
    <Animated.View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      entering={FadeIn.duration(120)}
      exiting={FadeOut.duration(110)}>
      {/* Scrim so the wheel reads over her, without hiding her — she stays present. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(6,8,12,0.72)' }]} />

      <Animated.View style={[styles.wheel, { left: cx - RADIUS, top: cy - RADIUS, width: RADIUS * 2, height: RADIUS * 2 }, pop]}>
        <Svg width={RADIUS * 2} height={RADIUS * 2} viewBox={`0 0 ${RADIUS * 2} ${RADIUS * 2}`}>
          {/* The ring the sectors sit on. Joe (2026-08-17): the wheel was too faint to find —
              brighter ring, stronger strokes, fuller labels. */}
          <Circle cx={RADIUS} cy={RADIUS} r={RADIUS - 6} fill="rgba(18,21,27,0.9)" stroke={`${theme.tint}66`} strokeWidth={1.5} />
          <Circle cx={RADIUS} cy={RADIUS} r={WHEEL_DEAD_ZONE} fill="rgba(8,8,10,0.92)" stroke={`${theme.tint}44`} strokeWidth={1} />

          {SPOKES.map((s) => {
            const rad = (s.deg * Math.PI) / 180;
            const r = (WHEEL_DEAD_ZONE + RADIUS - 6) / 2;
            const px = RADIUS + Math.cos(rad) * r;
            const py = RADIUS + Math.sin(rad) * r;
            const on = active === s.id;
            const dim = disabledFor(s);
            // The talk toggle is set apart from the six that navigate — it's the only one that
            // spends money, so it never looks like just another destination.
            const tone = s.id === 'toggle' ? '#e8c07d' : theme.tint;
            const opacity = dim ? 0.3 : on ? 1 : 0.92;
            return (
              <G key={s.id} opacity={opacity}>
                {on && !dim ? (
                  <Circle cx={px} cy={py} r={RADIUS * 0.235} fill={`${tone}33`} stroke={tone} strokeWidth={1.6} />
                ) : null}
                <G transform={`translate(${px}, ${py}) scale(${(RADIUS / 118).toFixed(3)})`}>
                  <Path d={s.icon} fill="none" stroke={tone} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </G>
                <SvgText
                  x={px}
                  y={py + RADIUS * 0.145}
                  fill={tone}
                  fontSize={RADIUS * 0.062}
                  letterSpacing={1.1}
                  textAnchor="middle"
                  opacity={1}>
                  {s.short}
                </SvgText>
              </G>
            );
          })}
        </Svg>

        {/* Centre reads the current choice — you never have to look away from your thumb. */}
        <View style={styles.hub} pointerEvents="none">
          <ThemedText
            type="code"
            style={[styles.hubText, { color: activeSpoke && !activeDisabled ? theme.tint : theme.textSecondary }]}
            numberOfLines={2}>
            {caption}
          </ThemedText>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wheel: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  hub: { position: 'absolute', width: WHEEL_DEAD_ZONE * 2.0, alignItems: 'center', justifyContent: 'center' },
  hubText: { fontSize: 12, letterSpacing: 1.3, textAlign: 'center', textTransform: 'uppercase' },
});

export { SPOKES };
