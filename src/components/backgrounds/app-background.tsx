import type { ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';

// Load the Skia scene defensively. If react-native-skia isn't in the native binary — e.g. a dev
// build that predates it — the module's top-level Skia import throws (RNSkiaModule not found).
// Catch it and degrade to a plain backdrop instead of crashing the entire app. Real builds (and any
// rebuilt dev client) link Skia, so the dots render normally; this only bites a stale binary.
let DotFieldScene: ComponentType | null = null;
try {
  DotFieldScene = require('./dot-field-scene').default;
} catch (e) {
  console.warn(
    '[AppBackground] Skia native module unavailable — rendering a plain backdrop. Rebuild the dev client to enable the dot-field background.',
    (e as Error)?.message,
  );
}

// The app-wide animated background. Rendered ONCE at the root (behind the tabs in
// _layout) so it's a single, continuous, indefinite loop that PERSISTS across view
// changes — switching tabs never remounts it, so it never restarts or flashes. The
// tab screens (Studio/Market/Account) render transparent so it shows through; Design
// keeps an opaque backdrop so it sits on top (no dots there).
//
// One canvas total → also the cheapest option for battery / WebGL contexts.
//
// NATIVE version: react-native-skia is a native module here, so the scene renders
// directly. The WEB build lives in app-background.web.tsx, which lazy-loads the
// CanvasKit WASM — that path must stay OUT of the native bundle because canvaskit-wasm
// imports Node's `fs`, which the RN runtime doesn't have (Metro keeps both branches of
// a `Platform.OS` check in dev, so a single shared file would break the dev bundle).

// A dark veil over the dots so text always has a consistent bed of contrast. The colour is the brand
// background (#08080a); raise/lower the alpha to make the dots quieter/livelier behind content.
const SCRIM = 'rgba(8,8,10,0.42)';
// Opaque brand-dark base BEHIND the dot canvas, so the background is never the platform-default
// white if Skia renders nothing (a blank canvas would otherwise show white and make the dark-mode
// text invisible).
const BASE = '#08080a';

export function AppBackground() {
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: BASE }]} pointerEvents="none">
      {DotFieldScene ? <DotFieldScene /> : null}
      {/* scrim — sits over the dots, under everything else, so text always pops */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM }]} />
    </View>
  );
}
