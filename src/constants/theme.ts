/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

// Nano Crew brand palette — monochrome (warm paper / near-black) with a single champagne
// gold accent (`tint`). Reserved serif is for the NC mark; everything else is clean sans.
export const Colors = {
  light: {
    text: '#16140f', // ink
    background: '#f4f3f0', // warm paper
    backgroundElement: '#ffffff', // cards lift off the paper
    backgroundSelected: '#e7e4dd',
    textSecondary: '#6b675e',
    tint: '#a8884e', // champagne gold (darkened for contrast on paper)
    // The designer canvas reads as a recessed work surface, distinct from the app chrome.
    canvas: '#E9EAEF',
    canvasDot: '#B9BCC8',
    canvasEdge: '#D4D6DE',
  },
  dark: {
    text: '#f3f1ec', // ink
    background: '#0a0a0c', // near-black
    backgroundElement: '#16161a',
    backgroundSelected: '#1f1f24',
    textSecondary: '#9a978f',
    tint: '#c9a86a', // champagne gold
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
