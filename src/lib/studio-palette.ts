import { useColorScheme } from '@/hooks/use-color-scheme';

// Shared theme-aware palette for the Studio surfaces (dashboard, composer, paywall,
// cockpit). Venus is a holographic entity: the cyan/violet accents hold on both light and
// dark, while the surface, ink and fields flip. Mirrors makePalette() in studio.tsx so the
// modals match the screen behind them in either mode.

export type StudioPalette = ReturnType<typeof makeStudioPalette>;

export function makeStudioPalette(dark: boolean) {
  return {
    dark,
    bg: dark ? '#0a0a0c' : '#f4f3f0', // sheet background
    surface: dark ? '#141417' : '#ffffff', // cards / thumbnails
    card: dark ? 'rgba(201,168,106,0.06)' : 'rgba(168,136,78,0.06)', // tinted panels
    ink: dark ? '#f3f1ec' : '#16140f', // primary text
    dim: dark ? '#9a978f' : '#6b675e', // secondary text
    accent: dark ? '#c9a86a' : '#a8884e', // champagne gold — darkened on light for contrast
    accent2: dark ? '#e3cd97' : '#8a6d3a', // lighter gold
    line: dark ? 'rgba(201,168,106,0.18)' : 'rgba(168,136,78,0.22)', // borders
    field: dark ? 'rgba(201,168,106,0.06)' : 'rgba(168,136,78,0.06)', // input fills
    onAccent: '#0a0a0c', // dark ink on gold buttons (reads in both modes)
    warn: dark ? '#e0a07a' : '#b5551f',
  };
}

export function useStudioPalette(): StudioPalette {
  return makeStudioPalette(useColorScheme() !== 'light');
}
