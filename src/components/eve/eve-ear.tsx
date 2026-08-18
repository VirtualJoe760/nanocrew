import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';

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

/** Her subtitles as a TOP BAND (Joe, 2026-08-17: bottom captions crowded the UI). The band
 *  RESERVES its height whenever she's live — content below shifts down once and stays put, so
 *  her words are always readable and never overlap controls. Mount FIRST in a surface's column. */
export function EveCaptions() {
  const [pulse, setPulse] = useState<EvePulse>({ state: 'off', caption: '' });
  useEffect(() => subscribeEvePulse(setPulse), []);
  if ((pulse?.state ?? 'off') === 'off') return null; // she's not live — no band, no dead space
  return (
    <View pointerEvents="none" style={styles.captionBand}>
      {pulse.caption.trim() ? (
        <ThemedText type="small" style={styles.captionText} numberOfLines={2}>
          {pulse.caption}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(12,16,22,0.85)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(124,199,223,0.4)' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 10, letterSpacing: 1 },
  captionBand: { minHeight: 48, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 4 },
  captionText: { color: '#e8eef4', textAlign: 'center' },
});
