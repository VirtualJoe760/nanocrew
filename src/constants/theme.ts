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
    textSecondary: '#ebedf1', // secondary text — near-white on dark so it pops (no grey)
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
    // The monospace label motif is retired — unified on Jost (Regular). Key kept so call
    // sites (ThemedText `code`, etc.) don't need to change.
    mono: 'Jost-Regular',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'Jost-Regular',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'Jost-Regular',
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

// The tab bar (components/app-tabs) is an expo-router/ui `Tabs` bar — a plain View laid out IN A
// FLEX COLUMN below the screen slot, NOT a floating/native UITabBar. So a screen sits entirely
// ABOVE it and reserves NOTHING for it (the bar pads its own home-indicator inset). This is 0; the
// named constant stays as the single knob at every call site in case the bar ever goes floating.
// The floating tab bar's CONTENT height (icon+label cluster + paddings, EXCLUDING the safe-area
// inset — screens add insets.bottom themselves). It was 0 while the bar was in-flow; the bar
// floats now, so screens must reserve this much or the bar clips their last control.
export const BottomTabInset = 52;
export const MaxContentWidth = 800;

/** Breathing room under a COLLAPSED bottom dock, so its tab handle clears the tab bar.
 *  (Lived in the designer's TemplatesDock until that dock was deleted, 2026-08-20.) */
export const DOCK_TAB_CLEARANCE = Spacing.two;
