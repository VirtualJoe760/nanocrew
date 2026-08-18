import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { subscribeEvePulse, type EvePulse } from '@/lib/eve-live-state-bus';

// EVE'S EAR + CAPTIONS — the truthful presence layer that rides inside popups stacked over her
// (product picker, placement, finalize): she is STILL live under them (Joe, 2026-08-17 — "she
// couldn't hear us" was the absence of any signal that she could). EveEar = dot + one word in the
// header; EveCaptions = her subtitles pinned to the bottom, persisting through every popup.

const TONE: Record<string, string> = {
  listening: '#7cc7df',
  speaking: '#cdd1d9',
  thinking: '#cdd1d9',
  connecting: '#8a8f99',
};

export function EveEar() {
  const [pulse, setPulse] = useState<EvePulse>({ state: 'off', caption: '' });
  useEffect(() => subscribeEvePulse(setPulse), []);
  const state = pulse?.state ?? 'off';
  if (state === 'off' || state === 'idle' || state === 'error') return null;
  const tone = TONE[state] ?? '#8a8f99';
  return (
    <View style={styles.pill}>
      <View style={[styles.dot, { backgroundColor: tone }]} />
      <ThemedText type="code" style={[styles.text, { color: tone }]}>
        {state === 'listening' ? 'EVE HEARS YOU' : state.toUpperCase()}
      </ThemedText>
    </View>
  );
}

/** Her subtitles, pinned above the bottom edge. Absolute — mount it LAST inside a modal's root. */
export function EveCaptions() {
  const insets = useSafeAreaInsets();
  const [pulse, setPulse] = useState<EvePulse>({ state: 'off', caption: '' });
  useEffect(() => subscribeEvePulse(setPulse), []);
  if (pulse.state === 'off' || !pulse.caption.trim()) return null;
  return (
    <View pointerEvents="none" style={[styles.captions, { bottom: insets.bottom + 12 }]}>
      <ThemedText type="small" style={styles.captionText} numberOfLines={2}>
        {pulse.caption}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(12,16,22,0.85)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(124,199,223,0.4)' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 10, letterSpacing: 1 },
  captions: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  captionText: { color: '#e8eef4', textAlign: 'center', backgroundColor: 'rgba(8,10,14,0.82)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, overflow: 'hidden' },
});
