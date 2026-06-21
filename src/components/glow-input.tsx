import { useState } from 'react';
import { Platform, StyleSheet, type StyleProp, TextInput, type TextInputProps, View, type ViewStyle } from 'react-native';

import { usePalette } from '@/components/nc-screen';
import { glow } from '@/constants/glow';

// The app's standard text input. It ALWAYS carries a soft cool nano-glow (a different hue from the
// platinum button glow); on focus the hue shifts a touch brighter and the halo grows — the field
// just "warms up", it doesn't suddenly gain a glow. Reuse instead of a bare <TextInput>.
// `containerStyle` lays out the outer wrap (margins, width); `style` styles the field.

// RN-web renders a real <input>, which the browser draws a rectangular focus outline on. Kill it so
// the only ring is our rounded halo. Harmless on native (the prop is ignored there).
const noWebOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

export function GlowInput({
  style,
  containerStyle,
  onFocus,
  onBlur,
  ...props
}: TextInputProps & { containerStyle?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  // Both states are cool (≠ the platinum buttons); focus is just a brighter, slightly shifted hue.
  const rest = p.accentCool; // #7cc7df / #2f7d8f
  const active = p.dark ? '#5fd3ea' : '#1f8ea3';
  return (
    <View
      style={[
        styles.wrap,
        containerStyle,
        {
          borderColor: focused ? active : p.dark ? 'rgba(124,199,223,0.40)' : 'rgba(47,125,143,0.35)',
          backgroundColor: p.dark ? 'rgba(205,209,217,0.05)' : 'rgba(68,71,78,0.04)',
        },
        // Always glow; on focus the hue brightens and the halo grows a little.
        glow(focused ? active : rest, focused ? 18 : 12, focused ? 0.6 : 0.38),
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
        style={[styles.input, { color: p.ink }, noWebOutline, style]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14 },
  input: { paddingVertical: 14, fontSize: 15 },
});
