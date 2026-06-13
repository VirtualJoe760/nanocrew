import { useColorScheme } from '@/hooks/use-color-scheme';

// Shared theme-aware palette for the Studio surfaces (dashboard, composer, paywall,
// cockpit). Venus is a holographic entity: the cyan/violet accents hold on both light and
// dark, while the surface, ink and fields flip. Mirrors makePalette() in studio.tsx so the
// modals match the screen behind them in either mode.

export type StudioPalette = ReturnType<typeof makeStudioPalette>;

export function makeStudioPalette(dark: boolean) {
  return {
    dark,
    bg: dark ? '#060b16' : '#eef3fa', // sheet background
    surface: dark ? '#0e1726' : '#ffffff', // cards / thumbnails
    card: dark ? 'rgba(53,214,255,0.05)' : 'rgba(22,182,224,0.05)', // tinted panels
    ink: dark ? '#ffffff' : '#0c1726', // primary text
    dim: dark ? 'rgba(214,234,255,0.6)' : '#586a82', // secondary text
    accent: dark ? '#35d6ff' : '#0e9fce', // cyan — darkened on light for contrast
    accent2: '#8b7bff', // violet
    line: dark ? 'rgba(53,214,255,0.2)' : 'rgba(31,112,153,0.18)', // borders
    field: dark ? 'rgba(53,214,255,0.06)' : 'rgba(22,182,224,0.06)', // input fills
    onAccent: '#06121f', // dark ink on cyan buttons (reads in both modes)
    warn: dark ? '#ff9a9a' : '#c0392b',
  };
}

export function useStudioPalette(): StudioPalette {
  return makeStudioPalette(useColorScheme() !== 'light');
}
