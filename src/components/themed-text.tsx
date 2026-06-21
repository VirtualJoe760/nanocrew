import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { textGlow } from '@/constants/glow';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary' | 'code';
  themeColor?: ThemeColor;
  /** A subtle platinum nano-glow behind the text so it lifts off the dark background. */
  glow?: boolean;
};

export function ThemedText({ style, type = 'default', themeColor, glow, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        { color: type === 'linkPrimary' ? theme.tint : theme[themeColor ?? 'text'] },
        glow && textGlow('rgba(205,209,217,0.5)', 10),
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'subtitle' && styles.subtitle,
        type === 'link' && styles.link,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'code' && styles.code,
        style,
      ]}
      {...rest}
    />
  );
}

// Jost ships as named static weights — RN custom fonts don't derive weight from `fontWeight`, so
// each visual weight maps to its own family. (Loaded in _layout.tsx.) Most text is Light 300; the
// "Nano Crew" wordmark is Thin 100, set directly where it's rendered.
const GS = {
  regular: 'Jost-Light', // 300 — body, links (the bulk of the UI)
  medium: 'Jost-Light', // 300 — body (default/small)
  semibold: 'Jost-Regular', // 400 — headings (title/subtitle)
  bold: 'Jost-Medium', // 500 — emphasis (smallBold / buttons)
} as const;

const styles = StyleSheet.create({
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: GS.medium,
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: GS.bold,
  },
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontFamily: GS.medium,
  },
  title: {
    fontSize: 48,
    fontFamily: GS.semibold,
    lineHeight: 52,
  },
  subtitle: {
    fontSize: 32,
    lineHeight: 44,
    fontFamily: GS.semibold,
  },
  link: {
    lineHeight: 30,
    fontSize: 14,
    fontFamily: GS.regular,
  },
  linkPrimary: {
    lineHeight: 30,
    fontSize: 14,
    fontFamily: GS.regular,
    // color comes from the theme tint (platinum on dark / graphite on light) — set inline above
  },
  code: {
    fontFamily: Fonts.mono, // now Jost-Regular — the mono motif is unified on Jost
    fontSize: 12,
  },
});
