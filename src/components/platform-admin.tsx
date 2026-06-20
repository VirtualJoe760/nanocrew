import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { openBrowserAsync } from 'expo-web-browser';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiFetch, readJson } from '@/lib/api';

// Platform-owner overview (admin emails only — gated by /api/platform/admin). Every store,
// total orders + revenue, creator count. Opens from the Account tab for admins.

type Store = { id: string; name: string; slug: string; status: string; deploymentUrl: string | null; createdAt: string };
type Data = { stores: Store[]; totals: { orders: number; revenueCents: number }; creators: number };

const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <ThemedView type="backgroundElement" style={styles.metric}>
      <ThemedText type="code" themeColor="textSecondary" style={styles.metricLabel}>{label}</ThemedText>
      <ThemedText type="subtitle">{value}</ThemedText>
    </ThemedView>
  );
}

export function PlatformAdmin({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  // Distinguish "you're not an admin" (403 — a final answer, no retry) from a transient
  // network/server failure (retryable) so an admin isn't told they lack access during an outage.
  const [errKind, setErrKind] = useState<'forbidden' | 'network' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch('/api/platform/admin');
      if (r.status === 401 || r.status === 403) {
        setData(null);
        setErrKind('forbidden');
        return;
      }
      setData(await readJson<Data>(r));
      setErrKind(null);
    } catch {
      setData(null);
      setErrKind('network');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const liveUrl = (s: Store) => (s.deploymentUrl && !s.deploymentUrl.includes('github.com') ? s.deploymentUrl : null);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ThemedView style={styles.fill}>
        <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <ThemedText type="code" themeColor="tint" style={styles.eyebrow}>PLATFORM</ThemedText>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose} hitSlop={12}>
              <ThemedText type="code" themeColor="textSecondary">close ✕</ThemedText>
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator style={styles.center} color={theme.tint} />
          ) : !data ? (
            <View style={styles.center}>
              {errKind === 'forbidden' ? (
                <ThemedText type="small" themeColor="textSecondary">Admin access only.</ThemedText>
              ) : (
                <>
                  <ThemedText type="small" themeColor="textSecondary">Couldn’t load — check your connection.</ThemedText>
                  <Pressable onPress={() => void load()} hitSlop={8} style={styles.retryBtn}>
                    <ThemedText type="smallBold" themeColor="tint">Try again</ThemedText>
                  </Pressable>
                </>
              )}
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
              <View style={styles.metricRow}>
                <Metric label="REVENUE" value={money(data.totals.revenueCents)} />
                <Metric label="ORDERS" value={String(data.totals.orders)} />
              </View>
              <View style={styles.metricRow}>
                <Metric label="CREATORS" value={String(data.creators)} />
                <Metric label="STORES" value={String(data.stores.length)} />
              </View>

              <ThemedText type="code" themeColor="textSecondary" style={styles.sectionLabel}>ALL STORES</ThemedText>
              {data.stores.map((s) => {
                const url = liveUrl(s);
                return (
                  <Pressable key={s.id} onPress={() => url && openBrowserAsync(url)} disabled={!url} style={styles.storeRow}>
                    <View style={{ flex: 1 }}>
                      <ThemedText type="smallBold" numberOfLines={1}>{s.name}</ThemedText>
                      <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>@{s.slug} · {s.status}{url ? ' · live ↗' : ''}</ThemedText>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </SafeAreaView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.four, paddingVertical: Spacing.three },
  eyebrow: { letterSpacing: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.six, gap: Spacing.three },
  retryBtn: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.four },
  scroll: { padding: Spacing.four, gap: Spacing.three },
  metricRow: { flexDirection: 'row', gap: Spacing.three },
  metric: { flex: 1, borderRadius: 12, padding: Spacing.four, gap: Spacing.one },
  metricLabel: { letterSpacing: 1.5, fontSize: 10 },
  sectionLabel: { letterSpacing: 1.5, fontSize: 11, marginTop: Spacing.three },
  storeRow: { paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(128,128,128,0.2)' },
});
