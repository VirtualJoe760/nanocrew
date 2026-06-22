import { StyleSheet, View } from 'react-native';

import DotFieldScene from './dot-field-scene';

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

export function AppBackground() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <DotFieldScene />
      {/* scrim — sits over the dots, under everything else, so text always pops */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM }]} />
    </View>
  );
}
