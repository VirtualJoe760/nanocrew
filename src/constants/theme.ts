/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

// Nano Crew brand palette — cool monochrome (paper / near-pure black) with a single platinum-silver
// accent (`tint`). No warmth, no gold — "depth, dimension, sophistication." The metallic gradient
// signature lives in lib/metallic.ts. Reserved serif is for the NC mark; everything else clean sans.
export const Colors = {
  light: {
    text: '#131316', // neutral ink
    background: '#f5f5f6', // cool paper
    backgroundElement: '#ffffff', // cards lift off the paper
    backgroundSelected: '#e9e9ec',
    textSecondary: '#6a6c73',
    tint: '#44474e', // graphite — the silver accent reads dark on a light ground
    // The designer canvas reads as a recessed work surface, distinct from the app chrome.
    canvas: '#E9EAEF',
    canvasDot: '#B9BCC8',
    canvasEdge: '#D4D6DE',
  },
  dark: {
    text: '#f4f4f6', // ink
    background: '#08080a', // near-pure black
    backgroundElement: '#161619',
    backgroundSelected: '#232327',
    textSecondary: '#9396a0',
    tint: '#cdd1d9', // platinum silver
    canvas: '#121319',
    canvasDot: '#34374a',
    canvasEdge: '#23242e',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
