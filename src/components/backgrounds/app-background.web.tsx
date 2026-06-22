import { StyleSheet, View } from 'react-native';

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

function Scene() {
  // Load CanvasKit, then the scene module. Required lazily so it's only ever evaluated on web.
  const { WithSkiaWeb } = require('@shopify/react-native-skia/lib/module/web');
  return <WithSkiaWeb getComponent={() => import('./dot-field-scene')} opts={CK_OPTS} fallback={null} />;
}

export function AppBackground() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Scene />
      {/* scrim — sits over the dots, under everything else, so text always pops */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM }]} />
    </View>
  );
}
