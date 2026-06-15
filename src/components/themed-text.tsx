import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary' | 'code';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        { color: type === 'linkPrimary' ? theme.tint : theme[themeColor ?? 'text'] },
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

// General Sans (the brand sans) ships as named static weights — RN custom fonts don't derive
// weight from `fontWeight`, so each visual weight maps to its own family. (Loaded in _layout.tsx.)
const GS = {
  regular: 'GeneralSans-Regular',
  medium: 'GeneralSans-Medium',
  semibold: 'GeneralSans-Semibold',
  bold: 'GeneralSans-Bold',
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
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
});
