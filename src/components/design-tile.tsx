import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Spacing } from '@/constants/theme';

const PALETTE = [
  '#E2574C',
  '#3B6FE0',
  '#F2A900',
  '#1FA67A',
  '#8E44EC',
  '#E0518B',
  '#15A0C4',
  '#D2691E',
];

/** Deterministic accent color from a seed string — stand-in until real artwork lands. */
export function tileColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Square placeholder for a generated design (real Nano Banana output goes here later). */
export function DesignTile({
  color,
  label,
  style,
}: {
  color: string;
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.tile, { backgroundColor: color }, style]}>
      {label ? (
        <Text style={styles.label} numberOfLines={3}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    aspectRatio: 1,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.three,
    overflow: 'hidden',
  },
  label: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
});
