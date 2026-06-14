import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { Easing, type SharedValue, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

// Venus's voice orb for the site-critique flow — a self-contained, audio-reactive bloom.
// Calm when idle; breathes and swells with the live audio `level` while `active` — her voice
// while she speaks, yours while she listens. Deliberately lighter than the Studio nucleus.
// `level` is a reanimated SharedValue (0..1) so it follows audio with no per-frame re-renders.

const GOLD = '#cdd1d9';

export function VenusOrb({
  active,
  level,
  size = 64,
  onPress,
}: {
  active: boolean;
  level?: SharedValue<number>;
  size?: number;
  onPress?: () => void;
}) {
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
    return { opacity: 0.22 + Math.min(0.6, energy * 0.5), transform: [{ scale: 1 + energy * 0.28 }] };
  });
  const ringStyle = useAnimatedStyle(() => ({
    opacity: active ? 0.45 + lvl.value * 0.55 : 0.18,
    transform: [{ rotate: `${spin.value}deg` }],
  }));
  const coreStyle = useAnimatedStyle(() => {
    const energy = active ? 0.35 + breathe.value * 0.22 + lvl.value * 0.9 : 0;
    return { transform: [{ scale: 1 + energy * 0.18 }] };
  });

  const r = size / 2;
  const coreSize = size * 0.6;
  return (
    <Pressable onPress={onPress} hitSlop={16} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, glowStyle]}>
        <Svg width={size} height={size}>
          <Defs>
            <RadialGradient id="vorb-glow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={GOLD} stopOpacity={0.6} />
              <Stop offset="68%" stopColor={GOLD} stopOpacity={0.12} />
              <Stop offset="100%" stopColor={GOLD} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={r} cy={r} r={r} fill="url(#vorb-glow)" />
        </Svg>
      </Animated.View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, ringStyle]}>
        <Svg width={size} height={size}>
          <Circle cx={r} cy={r} r={r - 5} fill="none" stroke={GOLD} strokeWidth={1} strokeDasharray="2 6" />
        </Svg>
      </Animated.View>
      <Animated.View pointerEvents="none" style={coreStyle}>
        <Svg width={coreSize} height={coreSize}>
          <Defs>
            <RadialGradient id="vorb-core" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#fff7e8" stopOpacity={1} />
              <Stop offset="38%" stopColor={GOLD} stopOpacity={0.95} />
              <Stop offset="100%" stopColor={GOLD} stopOpacity={0.08} />
            </RadialGradient>
          </Defs>
          <Circle cx={coreSize / 2} cy={coreSize / 2} r={coreSize / 2} fill="url(#vorb-core)" />
        </Svg>
      </Animated.View>
    </Pressable>
  );
}
