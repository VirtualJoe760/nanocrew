import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import VenusAvatar, { type VenusStage } from '@/components/venus-avatar';

// Venus's 3D avatar as a circular BUBBLE for the site-critique editor — her live face in the circle
// instead of the NC orb. A reactive halo breathes/swells with the audio while active (her voice as
// she speaks, yours as she listens) and a faint ring spins; tap to pause/resume. `speaking` drives
// her lifecycle stage. The disc backing matches the editor panel (#08080a) so the square GL canvas
// reads as a circle on native too (expo-gl doesn't reliably clip to a borderRadius).
const GLOW = '#d06bff'; // her hair-magenta halo tint
const PANEL = '#08080a'; // editor panel bg — the disc blends into it

export function VenusBubble({
  active,
  speaking,
  level,
  size = 96,
  onPress,
}: {
  /** Her view is live (listening or speaking) → halo animates. */
  active: boolean;
  /** She is speaking → `talking` stage; otherwise `silence`. */
  speaking: boolean;
  /** Live audio level 0..1 (reanimated) driving the halo intensity. */
  level?: SharedValue<number>;
  size?: number;
  onPress?: () => void;
}) {
  const stage: VenusStage = speaking ? 'talking' : 'silence';
  const breathe = useSharedValue(0);
  const spin = useSharedValue(0);
  const fallback = useSharedValue(0);
  const lvl = level ?? fallback;

  useEffect(() => {
    if (active) {
      breathe.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }), -1, true);
      spin.value = withRepeat(withTiming(360, { duration: 9000, easing: Easing.linear }), -1);
    } else {
      cancelAnimation(spin);
      breathe.value = withTiming(0, { duration: 300 });
    }
    return () => {
      cancelAnimation(breathe);
      cancelAnimation(spin);
    };
  }, [active, breathe, spin]);

  const glowStyle = useAnimatedStyle(() => {
    const energy = active ? 0.4 + breathe.value * 0.3 + lvl.value : 0.15;
    return { opacity: 0.25 + Math.min(0.6, energy * 0.5), transform: [{ scale: 1 + energy * 0.3 }] };
  });
  const ringStyle = useAnimatedStyle(() => ({
    opacity: active ? 0.5 + lvl.value * 0.5 : 0.22,
    transform: [{ rotate: `${spin.value}deg` }],
  }));

  const r = size / 2;
  const disc = Math.round(size * 0.84); // avatar circle, inset so the halo reads around it

  return (
    <Pressable onPress={onPress} hitSlop={16} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* reactive radial glow */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, glowStyle]}>
        <Svg width={size} height={size}>
          <Defs>
            <RadialGradient id="vbub-glow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={GLOW} stopOpacity={0.5} />
              <Stop offset="64%" stopColor={GLOW} stopOpacity={0.14} />
              <Stop offset="100%" stopColor={GLOW} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={r} cy={r} r={r} fill="url(#vbub-glow)" />
        </Svg>
      </Animated.View>

      {/* her face. WEB clips to a circle with overflow+borderRadius. NATIVE renders the GLView
          UNCLIPPED (clipping a GLView — overflow:hidden OR an evenodd SVG mask, which iOS doesn't
          honor — blanks/covers it on expo-gl); the transparent GL corners fall on the panel-coloured
          backing + editor panel, and the ring/rim define the circle. */}
      <View style={[styles.disc, { width: disc, height: disc, borderRadius: disc / 2 }]}>
        <VenusAvatar stage={stage} />
      </View>

      {/* faint spinning dashed ring + a solid rim to crisp the circle edge */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, ringStyle]}>
        <Svg width={size} height={size}>
          <Circle cx={r} cy={r} r={r - 3} fill="none" stroke={GLOW} strokeWidth={1.2} strokeDasharray="2 6" />
        </Svg>
      </Animated.View>
      <View pointerEvents="none" style={[styles.rim, { width: disc + 2, height: disc + 2, borderRadius: (disc + 2) / 2 }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  disc: {
    // Web clips the canvas to the circle; native must NOT (overflow:hidden blanks the GLView on iOS).
    overflow: Platform.OS === 'web' ? 'hidden' : 'visible',
    backgroundColor: PANEL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rim: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(208,107,255,0.45)',
  },
});
