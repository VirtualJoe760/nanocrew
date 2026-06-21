import { useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';

import { usePalette } from '@/components/nc-screen';
import { glow } from '@/constants/glow';

// The app's standard text input. Soft tinted fill + a platinum nano-glow on focus so the active
// field pops. Reuse this instead of a bare <TextInput>.
export function GlowInput({ style, onFocus, onBlur, ...props }: TextInputProps) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={[
        styles.wrap,
        { borderColor: focused ? p.accent : p.line, backgroundColor: p.dark ? 'rgba(205,209,217,0.05)' : 'rgba(68,71,78,0.04)' },
        focused && glow(p.accent, 12, 0.5),
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
