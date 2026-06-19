import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/hooks/use-auth';
import { useLiveVoice } from '@/hooks/use-live-voice';
import type { BrandResult } from '@/lib/interview';

// DEV spike to validate the Gemini Live pipeline end-to-end (token → connect → mic → playback →
// transcripts → save_brand) in isolation, before wiring it into Studio. Route: /live-test
export default function LiveTest() {
  const { session } = useAuth();
  const [brand, setBrand] = useState<BrandResult | null>(null);
  const live = useLiveVoice({
    accessToken: session?.access_token,
    userName: undefined,
    voiceName: 'Aoede',
    onBrand: (b) => setBrand(b),
  });

  return (
    <SafeAreaView style={styles.c}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
        <ThemedText type="title">Gemini Live spike</ThemedText>
        <ThemedText type="code" style={{ color: '#8aff8a' }}>state: {live.state}</ThemedText>
        {live.error ? <ThemedText type="small" style={{ color: '#ff6b6b' }}>error: {live.error}</ThemedText> : null}

        <View style={styles.row}>
          <Pressable onPress={live.start} style={[styles.btn, { backgroundColor: '#1f6feb' }]}>
            <ThemedText type="smallBold" style={{ color: '#fff' }}>Start</ThemedText>
          </Pressable>
          <Pressable onPress={live.stop} style={[styles.btn, { backgroundColor: '#444' }]}>
            <ThemedText type="smallBold" style={{ color: '#fff' }}>Stop</ThemedText>
          </Pressable>
        </View>

        <ThemedText type="small" style={styles.dim}>You said:</ThemedText>
        <ThemedText type="small">{live.userText || '—'}</ThemedText>
        <ThemedText type="small" style={styles.dim}>Venus:</ThemedText>
        <ThemedText type="small">{live.venusText || '—'}</ThemedText>

        {brand ? (
          <View style={{ marginTop: 20, gap: 6 }}>
            <ThemedText type="subtitle" style={{ color: '#8aff8a' }}>save_brand fired ✓</ThemedText>
            <ThemedText type="small">{brand.name} — {brand.tagline}</ThemedText>
            <ThemedText type="code" style={styles.dim}>{brand.designStyle} · {brand.products.join(', ')}</ThemedText>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: '#08080a' },
  row: { flexDirection: 'row', gap: 12 },
  btn: { paddingHorizontal: 28, paddingVertical: 14, borderRadius: 999 },
  dim: { color: '#9396a0', marginTop: 8 },
});
