import { useState } from 'react';
import { StyleSheet, type StyleProp, TextInput, type TextInputProps, View, type ViewStyle } from 'react-native';

import { usePalette } from '@/components/nc-screen';
import { glow } from '@/constants/glow';

// The app's standard text input. Soft tinted fill + a cool nano-glow on focus (a different hue from
// the platinum button glow) so the active field reads distinctly. Reuse this instead of a bare
// <TextInput>. `containerStyle` lays out the outer wrap (margins, width); `style` styles the field.
export function GlowInput({
  style,
  containerStyle,
  onFocus,
  onBlur,
  ...props
}: TextInputProps & { containerStyle?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={[
        styles.wrap,
        containerStyle,
        { borderColor: focused ? p.accentCool : p.line, backgroundColor: p.dark ? 'rgba(205,209,217,0.05)' : 'rgba(68,71,78,0.04)' },
        // Inputs glow a cooler hue than buttons (which glow platinum), so a focused field reads distinctly.
        focused && glow(p.accentCool, 14, 0.55),
      ]}>
      <TextInput
        {...props}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        placeholderTextColor={p.faint}
        style={[styles.input, { color: p.ink }, style]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14 },
  input: { paddingVertical: 14, fontSize: 15 },
});
