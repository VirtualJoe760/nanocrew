import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppBackground } from '@/components/backgrounds/app-background';
import type { VenusStage } from '@/components/backgrounds/venus-head-scene';

// THE VENUS LAB — our dedicated, permanent dev playground for iterating on Venus's appearance.
// Renders the live venus-head-scene full-screen so we can work on her in isolation. Entered via
// the `VENUS_LAB` flag in src/app/_layout.tsx (dev-only; never ships). Full guide: the "Venus Lab"
// section of docs/studio/VENUS_AVATAR.md. Returns null in production builds.

// The 4 testable lifecycle stages (the control row toggles between them).
const STAGES: VenusStage[] = ['pre-render', 'morphing', 'silence', 'talking'];

function Scene({ stage, onReveal }: { stage: VenusStage; onReveal?: (r: number) => void }) {
  // R3F renders on web (plain three/WebGL) and native (expo-gl) — no CanvasKit loader.
  const VenusHeadScene = require('@/components/backgrounds/venus-head-scene').default;
  return <VenusHeadScene stage={stage} onReveal={onReveal} />;
}

export default function Playground() {
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<VenusStage>('talking');
  // The app's dot-field background (the Account/Studio background) sits BEHIND the
  // transparent avatar canvas and fades out as she assembles — so pre-render IS the
  // app background, and she morphs out of it. Driven by the live reveal value.
  const bgOpacity = useRef(new Animated.Value(1)).current;
  const onReveal = useCallback((r: number) => {
    // full at the dust-field; dips to 0.28 mid-morph so the active R3F cyclone leads,
    // recovers to 0.35 once formed (the dots remain as a background behind her).
    const floor = 0.28 + 0.07 * Math.max(0, (r - 0.7) / 0.3);
    bgOpacity.setValue(Math.max(floor, 1 - r / 0.5));
  }, [bgOpacity]);
  if (!__DEV__) return null; // dev-only — never ships in a production build

  return (
    <View style={styles.root}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: bgOpacity }]} pointerEvents="none">
        <AppBackground />
      </Animated.View>
      <Scene stage={stage} onReveal={onReveal} />

      {/* top chrome */}
      <View style={[styles.topBar, { paddingTop: insets.top + 12 }]} pointerEvents="box-none">
        <Pressable onPress={() => router.back()} hitSlop={16} style={styles.back}>
          <Text style={styles.backText}>‹ back</Text>
        </Pressable>
        <Text style={styles.title}>VENUS · LAB</Text>
      </View>

      {/* stage control — toggle her lifecycle stage to test each phase */}
      <View style={[styles.stageBar, { bottom: insets.bottom + 42 }]} pointerEvents="box-none">
        {STAGES.map((s) => {
          const active = stage === s;
          return (
            <Pressable key={s} onPress={() => setStage(s)} style={[styles.pill, active && styles.pillActive]}>
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{s}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.foot, { bottom: insets.bottom + 16 }]}>
        venus avatar playground · docs/studio/VENUS_AVATAR.md
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#06080f' }, // brand navy — shows once the dot-field fades
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
  stageBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  pill: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(124,199,223,0.25)',
    backgroundColor: 'rgba(8,12,18,0.55)',
  },
  pillActive: {
    borderColor: '#5fd0e0',
    backgroundColor: 'rgba(95,208,224,0.18)',
  },
  pillText: { color: 'rgba(207,232,243,0.6)', fontFamily: 'Jost-Light', fontSize: 12, letterSpacing: 0.5 },
  pillTextActive: { color: '#dff4ff', fontFamily: 'Jost-Medium' },
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
