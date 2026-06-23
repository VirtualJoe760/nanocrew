import type { CSSProperties } from 'react';

// WEB build of the app-wide animated background.
//
// We deliberately DO NOT use CanvasKit/Skia on web. The Skia path spins up a WebGL surface PER mounted
// <AppBackground>, and the app renders one per tab screen (withScreenFade(..., {background:true})).
// expo-router (output:"server") keeps EVERY tab mounted and hides the inactive ones with display:none,
// collapsing their canvases to 0×0 — and CanvasKit's `Surface.flush` onto a 0×0 surface calls the
// Emscripten `abort()`, which kills the SHARED WASM runtime. After that, even the visible tab's canvas
// throws on its next flush, surfacing as an uncaught "Aborted()" that crashes the whole web app and
// floods the console. (Earlier mounted/onLayout gates couldn't fully fix it: display:none doesn't
// re-fire onLayout, and a single aborted runtime takes down every other canvas with it.)
//
// So web gets a robust, GPU-free CSS dot-field instead: a tiled radial-gradient grid of faint platinum
// dots on the brand-dark base that slowly drifts and breathes. It can never abort, needs no WASM, and
// is on-brand (cool monochrome + platinum silver). NATIVE keeps the real animated Skia shader — see
// app-background.tsx + dot-field-scene.tsx (unchanged).

// A dark veil over the dots so text always has a consistent bed of contrast.
const SCRIM = 'rgba(8,8,10,0.42)';
// Opaque brand-dark base BEHIND the dots, so the background is never the platform-default white.
const BASE = '#08080a';

const ANIM_CSS = `
@keyframes ncDotDrift { from { background-position: 0 0; } to { background-position: 26px 26px; } }
@keyframes ncDotBreathe { 0%, 100% { opacity: 0.7; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .nc-dotfield { animation: none !important; }
}`;

const fill: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none' };

const dots: CSSProperties = {
  ...fill,
  backgroundColor: BASE,
  // Two layered dot grids (a brighter fine grid + a softer offset grid) for subtle depth.
  backgroundImage:
    'radial-gradient(circle at 50% 50%, rgba(190,196,214,0.22) 0.9px, transparent 1.7px),' +
    'radial-gradient(circle at 50% 50%, rgba(150,156,176,0.12) 0.9px, transparent 1.7px)',
  backgroundSize: '26px 26px, 26px 26px',
  backgroundPosition: '0 0, 13px 13px',
  animation: 'ncDotDrift 26s linear infinite, ncDotBreathe 9s ease-in-out infinite',
  willChange: 'background-position, opacity',
};

export function AppBackground() {
  // Web-only file → raw DOM is fine (Metro resolves app-background.tsx on native). No CanvasKit, no
  // WebGL, no WASM — just CSS, so there is nothing here that can abort.
  return (
    <div style={{ ...fill, backgroundColor: BASE }}>
      <style>{ANIM_CSS}</style>
      <div className="nc-dotfield" style={dots} />
      {/* scrim — sits over the dots, under everything else, so text always pops */}
      <div style={{ ...fill, backgroundColor: SCRIM }} />
    </div>
  );
}
