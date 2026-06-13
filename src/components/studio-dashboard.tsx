import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { WebView } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { apiUrl } from '@/lib/api';

// The returning creator's Studio landing — no auto-AI. A small Venus presence, a live
// thumbnail of each brand's site (tap → edit mode), and a way to start a new brand.

const BG = '#04140c';
const GREEN = '#00ff7f';
const DIM = 'rgba(220,255,235,0.55)';

type StoreRow = { slug: string; name: string; revenueCents: number; orders: number; deploymentUrl?: string | null };

function siteUrlFor(s: StoreRow): string {
  if (s.deploymentUrl && !s.deploymentUrl.includes('github.com')) return s.deploymentUrl;
  return `https://store-${s.slug}.vercel.app`;
}

/** A small, calm stand-in for the Venus entity — not the full animated orb. */
function VenusGlyph() {
  return (
    <Svg width={40} height={40}>
      <Defs>
        <RadialGradient id="vg" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#eafff4" stopOpacity={1} />
          <Stop offset="45%" stopColor={GREEN} stopOpacity={0.9} />
          <Stop offset="100%" stopColor={GREEN} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={20} cy={20} r={19} fill="none" stroke={GREEN} strokeWidth={0.8} opacity={0.4} />
      <Circle cx={20} cy={20} r={9} fill="url(#vg)" />
    </Svg>
  );
}

export function StudioDashboard({
  token,
  onEditBrand,
  onNewBrand,
}: {
  token: string;
  onEditBrand: (slug: string) => void;
  onNewBrand: () => void;
}) {
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch(apiUrl('/api/creator/stats'), { headers: { Authorization: `Bearer ${token}` } });
      const d = (await r.json()) as { stores?: StoreRow[] };
      setStores(d.stores ?? []);
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.venusRow}>
        <VenusGlyph />
        <View>
          <ThemedText type="code" style={styles.eyebrow}>VENUS</ThemedText>
          <ThemedText type="small" style={styles.dim}>Tap a brand to edit, or start a new one.</ThemedText>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: Spacing.six }} color={GREEN} />
      ) : (
        <>
          {stores.map((s) => (
            <Pressable key={s.slug} onPress={() => onEditBrand(s.slug)} style={styles.brandCard}>
              <View style={styles.thumb}>
                <WebView source={{ uri: siteUrlFor(s) }} style={styles.thumbWeb} pointerEvents="none" scrollEnabled={false} />
                <View style={styles.editTag}>
                  <ThemedText type="code" style={styles.editTagText}>edit →</ThemedText>
                </View>
              </View>
              <View style={styles.brandMeta}>
                <ThemedText type="subtitle" style={styles.white}>{s.name}</ThemedText>
                <ThemedText type="code" style={styles.dim}>
                  ${(s.revenueCents / 100).toFixed(2)} · {s.orders} {s.orders === 1 ? 'order' : 'orders'}
                </ThemedText>
              </View>
            </Pressable>
          ))}

          <Pressable onPress={onNewBrand} style={styles.newBrand}>
            <ThemedText type="code" style={styles.plus}>+</ThemedText>
            <View>
              <ThemedText type="smallBold" style={styles.green}>Build a new brand</ThemedText>
              <ThemedText type="code" style={styles.dim}>Start another store with Venus.</ThemedText>
            </View>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { paddingBottom: Spacing.six, gap: Spacing.four },
  venusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingTop: Spacing.two },
  eyebrow: { color: GREEN, letterSpacing: 2 },
  brandCard: { borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(0,255,127,0.2)', backgroundColor: 'rgba(0,255,127,0.04)' },
  thumb: { height: 200, backgroundColor: '#fff' },
  thumbWeb: { flex: 1 },
  editTag: { position: 'absolute', right: Spacing.three, bottom: Spacing.three, backgroundColor: GREEN, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 5 },
  editTagText: { color: BG, fontSize: 11, letterSpacing: 0.5 },
  brandMeta: { padding: Spacing.three, gap: 2 },
  newBrand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(0,255,127,0.3)', padding: Spacing.four },
  plus: { color: GREEN, fontSize: 28, width: 30, textAlign: 'center' },
  white: { color: '#fff' },
  dim: { color: DIM },
  green: { color: GREEN },
});
