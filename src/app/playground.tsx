import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';

// THE VENUS LAB — our dedicated, permanent dev playground for iterating on Venus's appearance.
// Renders the live venus-head-scene full-screen so we can work on her in isolation. Entered via
// the `VENUS_LAB` flag in src/app/_layout.tsx (dev-only; never ships). Full guide: the "Venus Lab"
// section of docs/studio/VENUS_AVATAR.md. Returns null in production builds.

function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator color="#7cc7df" />
      <Text style={styles.loadingText}>loading skia…</Text>
    </View>
  );
}

function Scene() {
  // R3F renders on web (plain three/WebGL) and native (expo-gl) — no CanvasKit loader.
  const VenusHeadScene = require('@/components/backgrounds/venus-head-scene').default;
  // Lab loop: ping-pong the dots-morph reveal so we can iterate it hands-free.
  // The first toggle waits LONGER so the GLB has time to load + do its first assemble.
  const [reveal, setReveal] = useState(true);
  useEffect(() => {
    let id: ReturnType<typeof setInterval>;
    const warmup = setTimeout(() => {
      setReveal(false);
      id = setInterval(() => setReveal((v) => !v), 5500);
    }, 8000); // assemble on load, hold ~8s, then ping-pong every 5.5s
    return () => { clearTimeout(warmup); if (id) clearInterval(id); };
  }, []);
  return <VenusHeadScene reveal={reveal} />;
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
        <Text style={styles.title}>VENUS · LAB</Text>
      </View>

      <Text style={[styles.foot, { bottom: insets.bottom + 16 }]}>
        venus avatar playground · docs/studio/VENUS_AVATAR.md
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
