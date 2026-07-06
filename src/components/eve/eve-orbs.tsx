import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, G, Path, RadialGradient, Stop } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { EveIcon, EveNode } from '@/lib/eve-capabilities';

// EVE'S ENERGY ORBS — the tappable affordances that bloom from her net (docs/studio/EVE_CONTROL.md).
// The wedge: a static ring of glowing orbs along the lower screen, one per visible capability node,
// fed by the registry. Tap fires the node. Each orb condenses in (staggered bloom) and breathes.
// Rendered as react-native-svg + reanimated OVER the constellation — the hybrid path (crisp icons,
// reliable taps) agreed with Joe; the net-emits-the-orb transition + drag-through traversal land in
// Phase C1/C2.

const SIZE = 60;
const ENERGY = '#7fd7e6'; // the constellation net's teal — the orbs read as made of her

function OrbIcon({ icon }: { icon: EveIcon }) {
  const s = { stroke: '#e6f7fb', strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (icon) {
    case 'brand': // sparkle
      return <Path d="M11 2.5 L12.7 9.3 L19.5 11 L12.7 12.7 L11 19.5 L9.3 12.7 L2.5 11 L9.3 9.3 Z" {...s} />;
    case 'edit': // pencil
      return (
        <G>
          <Path d="M5 15.5 L5 12.5 L13 4.5 L16 7.5 L8 15.5 Z" {...s} />
          <Path d="M12 5.5 L15 8.5" {...s} />
        </G>
      );
    case 'design': // framed image + spark
      return (
        <G>
          <Path d="M3.5 5 h15 v12 h-15 Z" {...s} />
          <Path d="M3.5 14 l4 -3 3 2 4 -4 3.5 3.5" {...s} />
          <Circle cx={8} cy={8.5} r={1.3} {...s} />
        </G>
      );
    case 'meme': // smiley
      return (
        <G>
          <Circle cx={11} cy={11} r={7.6} {...s} />
          <Circle cx={8.4} cy={9.5} r={0.7} fill="#e6f7fb" stroke="none" />
          <Circle cx={13.6} cy={9.5} r={0.7} fill="#e6f7fb" stroke="none" />
          <Path d="M7.6 13 q3.4 3 6.8 0" {...s} />
        </G>
      );
    case 'post': // document
      return (
        <G>
          <Path d="M6 3 h7 l4 4 v12 h-11 Z" {...s} />
          <Path d="M13 3 v4 h4" {...s} />
          <Path d="M8.5 12 h6 M8.5 15 h6" {...s} />
        </G>
      );
    case 'store': // shopping bag
      return (
        <G>
          <Path d="M5 7 h12 l-1 11 h-10 Z" {...s} />
          <Path d="M8 8 v-1.5 a3 3 0 0 1 6 0 V8" {...s} />
        </G>
      );
    case 'digest': // pulse line
      return <Path d="M2.5 13 l3 0 2 -6 3 10 2 -8 2 4 4 0" {...s} />;
    default: // nav chevron
      return <Path d="M8.5 5 l6 6 -6 6" {...s} />;
  }
}

function Orb({ node, index, onPress }: { node: EveNode; index: number; onPress: () => void }) {
  const enter = useSharedValue(0);
  const pulse = useSharedValue(0);
  useEffect(() => {
    const delay = index * 100;
    enter.value = withDelay(delay, withTiming(1, { duration: 460, easing: Easing.out(Easing.cubic) }));
    pulse.value = withDelay(
      delay,
      withRepeat(withSequence(withTiming(1, { duration: 1500 }), withTiming(0, { duration: 1500 })), -1, true),
    );
    // run once on mount / when this orb's identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);
  const style = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 14 }, { scale: enter.value * (1 + pulse.value * 0.05) }],
  }));
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={node.label} style={styles.item}>
      <Animated.View style={[styles.orb, style]}>
        <Svg width={SIZE} height={SIZE} viewBox="0 0 60 60">
          <Defs>
            <RadialGradient id={`glow-${node.id}`} cx="50%" cy="44%" r="56%">
              <Stop offset="0%" stopColor={ENERGY} stopOpacity={0.6} />
              <Stop offset="58%" stopColor={ENERGY} stopOpacity={0.16} />
              <Stop offset="100%" stopColor={ENERGY} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={30} cy={30} r={29} fill={`url(#glow-${node.id})`} />
          <Circle cx={30} cy={30} r={19} fill="rgba(7,11,17,0.55)" stroke={ENERGY} strokeOpacity={0.55} strokeWidth={1} />
          <G transform="translate(19, 19)">
            <OrbIcon icon={node.icon} />
          </G>
        </Svg>
      </Animated.View>
      <ThemedText type="code" style={styles.label} numberOfLines={1}>
        {node.label}
      </ThemedText>
    </Pressable>
  );
}

/** The ring of energy orbs — one per visible capability node. `onBack`, when present, means we're
 *  inside a branch: a back affordance appears so the creator can rise back to the parent ring. */
export function EveOrbRing({
  nodes,
  onSelect,
  onBack,
}: {
  nodes: EveNode[];
  onSelect: (node: EveNode) => void;
  onBack?: () => void;
}) {
  if (!nodes.length) return null;
  return (
    <View style={styles.dock}>
      <View style={styles.ring}>
        {nodes.map((n, i) => (
          <Orb key={n.id} node={n} index={i} onPress={() => onSelect(n)} />
        ))}
      </View>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={10} accessibilityLabel="Back" style={styles.back}>
          <ThemedText type="code" style={styles.backLabel}>‹ back</ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { alignItems: 'center', gap: Spacing.two },
  ring: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: Spacing.four,
    paddingHorizontal: Spacing.three,
  },
  item: { alignItems: 'center', width: SIZE + 18, gap: 5 },
  orb: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  label: { color: 'rgba(223,244,255,0.82)', fontSize: 11, textAlign: 'center', letterSpacing: 0.2 },
  back: { paddingVertical: 4, paddingHorizontal: 12 },
  backLabel: { color: 'rgba(207,232,243,0.6)', fontSize: 13, letterSpacing: 0.5 },
});
