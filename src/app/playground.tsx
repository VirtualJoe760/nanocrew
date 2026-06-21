import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

// Dev-only sandbox for GPU / shader experiments (react-native-skia). NOT linked in the tab bar —
// navigate to `/playground` by hand. It renders the shared background scene
// (components/backgrounds/dot-field-scene) full-screen so we can iterate on it in isolation.
// On web, CanvasKit (the Skia WASM runtime) is lazy-loaded via WithSkiaWeb; on native it's the JSI
// module and renders directly. Returns null in production builds.

function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator color="#7cc7df" />
      <Text style={styles.loadingText}>loading skia…</Text>
    </View>
  );
}

function Scene() {
  if (Platform.OS === 'web') {
    // Web-only: load CanvasKit, then the scene module. Required lazily so native never evaluates it.
    // The CanvasKit WASM isn't served at its default path under Metro/Expo web, so point it at the
    // matching CDN build (Skia 2.2.12 bundles canvaskit-wasm 0.40.0).
    const { WithSkiaWeb } = require('@shopify/react-native-skia/lib/module/web');
    return (
      <WithSkiaWeb
        getComponent={() => import('@/components/backgrounds/venus-field-scene')}
        fallback={<Loading />}
        opts={{ locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/canvaskit-wasm@0.40.0/bin/full/${file}` }}
      />
    );
  }
  const VenusFieldScene = require('@/components/backgrounds/venus-field-scene').default;
  return <VenusFieldScene />;
}

export default function Playground() {
  const insets = useSafeAreaInsets();
  if (!__DEV__) return null; // dev-only — never ships in a production build

  return (
    <View style={styles.root}>
      <Scene />

      {/* overlay chrome */}
      <View style={[styles.topBar, { paddingTop: insets.top + 12 }]} pointerEvents="box-none">
        <Pressable onPress={() => router.back()} hitSlop={16} style={styles.back}>
          <Text style={styles.backText}>‹ back</Text>
        </Pressable>
        <Text style={styles.title}>NEON · TRACELIGHT</Text>
      </View>

      <Text style={[styles.foot, { bottom: insets.bottom + 16 }]}>
        react-native-skia · SkSL runtime shader
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000', gap: 10 },
  loadingText: { color: '#7cc7df', fontFamily: 'Jost-Light', fontSize: 13, letterSpacing: 1 },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: { paddingVertical: 4, paddingHorizontal: 4 },
  backText: { color: 'rgba(244,244,246,0.7)', fontFamily: 'Jost-Light', fontSize: 15 },
  title: { color: '#f4f4f6', fontFamily: 'Jost-Thin', fontSize: 16, letterSpacing: 3 },
  foot: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: 'rgba(124,199,223,0.6)',
    fontFamily: 'Jost-Light',
    fontSize: 12,
    letterSpacing: 1.5,
  },
});
