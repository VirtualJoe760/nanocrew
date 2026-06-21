import { Platform, StyleSheet, View } from 'react-native';

// The app-wide animated background. Rendered ONCE at the root (behind the tabs in
// _layout) so it's a single, continuous, indefinite loop that PERSISTS across view
// changes — switching tabs never remounts it, so it never restarts or flashes. The
// tab screens (Studio/Market/Account) render transparent so it shows through; Design
// keeps an opaque backdrop so it sits on top (no dots there).
//
// One canvas total → also the cheapest option for battery / WebGL contexts.
//
// Skia is a native module; on web the CanvasKit WASM is lazy-loaded via WithSkiaWeb
// (pointed at the matching CDN build). The scene lives in dot-field-scene.tsx.

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
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Scene />
      {/* scrim — sits over the dots, under everything else, so text always pops */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM }]} />
    </View>
  );
}
