import { useEffect, useState } from 'react';
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
  // TWO gates, both required:
  //
  // 1. `mounted` (set in a useEffect — which NEVER runs during server render). The web build is
  //    output:"server", so every page is server-rendered in Node. If the CanvasKit <Scene/> renders
  //    on the server, CanvasKit tries to load its WASM from the CDN URL, which Node treats as a local
  //    FILE path (`https:/cdn…` — note the single slash) → ENOENT → Emscripten `abort()`, flooding the
  //    logs with `Aborted()` and destroying the SSR response stream. Gating on a client-only mount flag
  //    keeps CanvasKit off the server entirely.
  // 2. `ready` — wait for a real, non-zero layout size. On web expo-router keeps EVERY tab screen
  //    mounted and hides inactive ones with `display:none`, collapsing this absoluteFill (and its
  //    CanvasKit <canvas>) to 0×0 while the Skia clock keeps ticking; CanvasKit `abort()`s drawing onto
  //    a 0×0 surface once per frame per hidden tab. (dot-field-scene's own guard can't catch this — it
  //    reads useWindowDimensions(), which stays 812px even when this element is collapsed.)
  //
  // Web-only — native (app-background.tsx) is untouched.
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setMounted(true), []);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setReady(width > 0 && height > 0);
  };
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: BASE }]} pointerEvents="none" onLayout={onLayout}>
      {mounted && ready ? <Scene /> : null}
      {/* scrim — sits over the dots, under everything else, so text always pops */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM }]} />
    </View>
  );
}
