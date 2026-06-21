import { useCallback, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

// The app-wide animated background. Render it as a screen's base layer (first child,
// absolute-fill, behind the content) so the app feels of one piece. NOT used on the
// Design screen, which keeps its own neutral backdrop.
//
// Skia is a native module; on web the CanvasKit WASM is lazy-loaded via WithSkiaWeb
// (pointed at the matching CDN build — see playground.tsx for the same fix). The
// scene itself lives in dot-field-scene.tsx.
//
// Perf: the animated Skia canvas only mounts while its screen is FOCUSED (native tabs
// keep screens mounted, so an always-on canvas would burn battery/GPU off-screen, and
// on web would hold a WebGL context per screen). When not focused only the dark scrim
// remains — which matches the base background, so there's no visible gap.

const CK_OPTS = {
  locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/canvaskit-wasm@0.40.0/bin/full/${file}`,
};

// A dark veil over the dots so text always has a consistent bed of contrast. The colour is the brand
// background (#08080a); raise/lower the alpha to make the dots quieter/livelier behind content.
const SCRIM = 'rgba(8,8,10,0.42)';

function Scene() {
  if (Platform.OS === 'web') {
    // Web: load CanvasKit, then the scene module. Required lazily so native never evaluates it.
    const { WithSkiaWeb } = require('@shopify/react-native-skia/lib/module/web');
    return <WithSkiaWeb getComponent={() => import('./dot-field-scene')} opts={CK_OPTS} fallback={null} />;
  }
  const DotFieldScene = require('./dot-field-scene').default;
  return <DotFieldScene />;
}

export function AppBackground() {
  // Mount the animated canvas only while this screen is focused.
  const [active, setActive] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setActive(true);
      return () => setActive(false);
    }, []),
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {active ? <Scene /> : null}
      {/* scrim — sits over the dots, under the screen content, so text always pops */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM }]} />
    </View>
  );
}
