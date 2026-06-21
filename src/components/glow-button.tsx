import { ActivityIndicator, Pressable, type StyleProp, StyleSheet, type ViewStyle } from 'react-native';

import { usePalette } from '@/components/nc-screen';
import { ThemedText } from '@/components/themed-text';
import { glow } from '@/constants/glow';

// The app's standard button. One depth language (nano glow), three weights:
//   primary   — filled platinum, strong halo (the main CTA)
//   secondary — outlined, soft halo
//   ghost     — text only (tertiary / decline)
// Reuse this instead of styling a bare <Pressable>. Press scales + dims the glow for tactile feedback.

type Variant = 'primary' | 'secondary' | 'ghost';

export function GlowButton({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  const primary = variant === 'primary';
  const secondary = variant === 'secondary';
  const off = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.base,
        primary && { backgroundColor: p.accent },
        secondary && { borderWidth: 1, borderColor: p.accent },
        variant === 'ghost' && styles.ghost,
        primary && glow(p.accent, 18, pressed ? 0.3 : 0.6),
        secondary && glow(p.accent, 12, pressed ? 0.18 : 0.4),
        off && { opacity: 0.45 },
        pressed && !off && { transform: [{ scale: 0.98 }] },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={primary ? p.bg : p.accent} />
      ) : (
        <ThemedText type="smallBold" glow={!primary} style={{ color: primary ? p.bg : p.ink }}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: 16, paddingVertical: 15, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  ghost: { paddingVertical: 9 },
});
