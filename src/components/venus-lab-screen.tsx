import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';

import VenusLab, { type VenusStage } from '@/components/venus-lab';

// THE VENUS LAB — the live venus-head-scene full-screen, for iterating on Venus's appearance in
// isolation. Now surfaced as a TEST tool from the Account screen (gated to the Venus-Lab tester
// email), not a tab. `onBack` returns to wherever it was opened from (the Account page). The avatar
// comes from <VenusLab>, a COMPONENT split: venus-lab.web.tsx renders the real R3F scene on web,
// venus-lab.tsx on native (expo-gl). Full guide: docs/studio/VENUS_AVATAR.md.

const STAGES: VenusStage[] = ['pre-render', 'morphing', 'silence', 'talking'];

export default function VenusLabScreen({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<VenusStage>('talking');

  // No Skia <AppBackground> here: the UNIFIED LATTICE inside the transparent avatar canvas IS the
  // dot-field background (one field that becomes her), over the near-black bed.
  return (
    <View style={styles.root}>
      <VenusLab stage={stage} />

      {/* top chrome */}
      <View style={[styles.topBar, { paddingTop: insets.top + 12 }]} pointerEvents="box-none">
        <Pressable onPress={onBack} hitSlop={16} style={styles.back}>
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
        venus avatar lab · docs/studio/VENUS_AVATAR.md
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
