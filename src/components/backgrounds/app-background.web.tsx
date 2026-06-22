import { useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';

// WEB build of the app-wide animated background. Skia on web needs the CanvasKit WASM, lazy-loaded
// via WithSkiaWeb. This file is web-only (Metro resolves app-background.tsx on native) so the native
// bundle never pulls in canvaskit-wasm — which imports the Node `fs` module and breaks the RN bundle.
// See app-background.tsx for the native version + the shared rationale.

const CK_OPTS = {
  locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/canvaskit-wasm@0.40.0/bin/full/${file}`,
};

// A dark veil over the dots so text always has a consistent bed of contrast. The colour is the brand
// background (#08080a); raise/lower the alpha to make the dots quieter/livelier behind content.
const SCRIM = 'rgba(8,8,10,0.42)';
// Opaque brand-dark base BEHIND the dot canvas, so the background is never white while CanvasKit is
// loading or if it renders nothing.
const BASE = '#08080a';

function Scene() {
  // Load CanvasKit, then the scene module. Required lazily so it's only ever evaluated on web.
  const { WithSkiaWeb } = require('@shopify/react-native-skia/lib/module/web');
  return <WithSkiaWeb getComponent={() => import('./dot-field-scene')} opts={CK_OPTS} fallback={null} />;
}

export function AppBackground() {
  // Only mount the CanvasKit scene once the container has a real, non-zero layout size. On web,
  // expo-router keeps EVERY tab screen mounted and hides the inactive ones with `display:none` —
  // which collapses this absoluteFill (and its CanvasKit <canvas>) to 0×0 while the Skia clock keeps
  // ticking. CanvasKit calls `abort()` when it tries to draw onto a 0×0 surface, flooding the console
  // with stack-traceless `Aborted()` once per frame for each hidden tab. The dot-field-scene guard
  // can't catch this: it reads useWindowDimensions() (the WINDOW stays 812px even when the screen is
  // hidden), not this element's own collapsed size. Gating on the measured size fixes both the hidden
  // tabs and the brief 0×0 first mount. Web-only — native (app-background.tsx) is untouched.
  const [ready, setReady] = useState(false);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setReady(width > 0 && height > 0);
  };
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: BASE }]} pointerEvents="none" onLayout={onLayout}>
      {ready ? <Scene /> : null}
      {/* scrim — sits over the dots, under everything else, so text always pops */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM }]} />
    </View>
  );
}
