import { useColorScheme } from '@/hooks/use-color-scheme';

// Shared theme-aware palette for the Studio surfaces (dashboard, composer, paywall,
// cockpit). Venus is a holographic entity: the cyan/violet accents hold on both light and
// dark, while the surface, ink and fields flip. Mirrors makePalette() in studio.tsx so the
// modals match the screen behind them in either mode.

export type StudioPalette = ReturnType<typeof makeStudioPalette>;

export function makeStudioPalette(dark: boolean) {
  return {
    dark,
    bg: dark ? '#08080a' : '#f5f5f6', // sheet background
    surface: dark ? '#161619' : '#ffffff', // cards / thumbnails
    card: dark ? 'rgba(205,209,217,0.05)' : 'rgba(68,71,78,0.05)', // tinted panels (silver/graphite)
    ink: dark ? '#f4f4f6' : '#131316', // primary text
    dim: dark ? '#c6c8cf' : '#54565e', // secondary text — brightened again to read over the dot field
    accent: dark ? '#cdd1d9' : '#44474e', // platinum silver / graphite on light
    accent2: dark ? '#e8eaee' : '#2c2e34', // brighter silver / darker graphite
    line: dark ? 'rgba(205,209,217,0.16)' : 'rgba(68,71,78,0.2)', // borders
    field: dark ? 'rgba(205,209,217,0.05)' : 'rgba(68,71,78,0.05)', // input fills
    onAccent: dark ? '#08080a' : '#f5f5f6', // dark ink on the silver button / light on graphite
    warn: dark ? '#e0a07a' : '#b5551f', // kept warm — errors stay legible against the mono brand
  };
}

export function useStudioPalette(): StudioPalette {
  return makeStudioPalette(useColorScheme() !== 'light');
}
