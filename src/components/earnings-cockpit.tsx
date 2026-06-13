import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { apiUrl } from '@/lib/api';

// The creator's business cockpit — revenue, orders, traffic, recent activity.
// Reads the same authed endpoints the brand-site /admin uses (/api/creator/*).
// Venus can speak a summary; this is the visual surface.

const BG = '#060b16';
const GREEN = '#35d6ff';
const DIM = 'rgba(214,234,255,0.55)';

type StoreStat = { id: string; slug: string; name: string; orders: number; revenueCents: number; views30d: number };
type OrderRow = { id: string; storeSlug?: string; status: string; totalCents: number; createdAt: string; trackingUrl: string | null };

const money = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_LABEL: Record<string, string> = {
  pending_payment: 'unpaid',
  paid: 'paid',
  submitted_to_printful: 'in queue',
  in_production: 'printing',
  shipped: 'shipped',
  delivered: 'delivered',
  cancelled: 'cancelled',
  refunded: 'refunded',
};

export function EarningsCockpit({ visible, onClose, token }: { visible: boolean; onClose: () => void; token: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stores, setStores] = useState<StoreStat[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const [s, o] = await Promise.all([
          fetch(apiUrl('/api/creator/stats'), { headers }).then((r) => r.json()),
          fetch(apiUrl('/api/creator/orders'), { headers }).then((r) => r.json()),
        ]);
        if (!alive) return;
        setStores(s.stores ?? []);
        setOrders(o.orders ?? []);
      } catch {
        if (alive) setError('Could not load your numbers — try again.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, token]);

  const totalRevenue = stores.reduce((n, s) => n + s.revenueCents, 0);
  const totalOrders = stores.reduce((n, s) => n + s.orders, 0);
  const totalViews = stores.reduce((n, s) => n + s.views30d, 0);
  // Orders that have been paid for but not yet shipped — what needs attention.
  const open = orders.filter((o) => ['paid', 'submitted_to_printful', 'in_production'].includes(o.status)).length;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <ThemedText type="code" style={styles.eyebrow}>
              {'// EARNINGS'}
            </ThemedText>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose} hitSlop={12}>
              <ThemedText type="code" style={styles.close}>
                close ✕
              </ThemedText>
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator style={styles.center} color={GREEN} />
          ) : error ? (
            <ThemedText style={[styles.center, styles.dim]}>{error}</ThemedText>
          ) : !stores.length ? (
            <View style={styles.center}>
              <ThemedText type="subtitle" style={styles.white}>
                No store yet
              </ThemedText>
              <ThemedText type="small" style={styles.dim}>
                Build one with your consultant — your numbers will live here.
              </ThemedText>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
              {/* Headline cards */}
              <View style={styles.cardRow}>
                <View style={styles.card}>
                  <ThemedText type="code" style={styles.cardLabel}>
                    REVENUE
                  </ThemedText>
                  <ThemedText type="title" style={styles.cardBig}>
                    {money(totalRevenue)}
                  </ThemedText>
                </View>
                <View style={styles.card}>
                  <ThemedText type="code" style={styles.cardLabel}>
                    ORDERS
                  </ThemedText>
                  <ThemedText type="title" style={styles.cardBig}>
                    {totalOrders}
                  </ThemedText>
                </View>
              </View>
              <View style={styles.cardRow}>
                <View style={styles.card}>
                  <ThemedText type="code" style={styles.cardLabel}>
                    VIEWS · 30D
                  </ThemedText>
                  <ThemedText type="title" style={styles.cardBig}>
                    {totalViews.toLocaleString()}
                  </ThemedText>
                </View>
                <View style={styles.card}>
                  <ThemedText type="code" style={styles.cardLabel}>
                    TO FULFILL
                  </ThemedText>
                  <ThemedText type="title" style={[styles.cardBig, open ? styles.alert : undefined]}>
                    {open}
                  </ThemedText>
                </View>
              </View>

              {/* Per-store breakdown (only if more than one) */}
              {stores.length > 1 ? (
                <View style={styles.section}>
                  <ThemedText type="code" style={styles.sectionLabel}>
                    BY STORE
                  </ThemedText>
                  {stores.map((s) => (
                    <View key={s.id} style={styles.storeRow}>
                      <ThemedText type="small" style={styles.white}>
                        {s.name}
                      </ThemedText>
                      <ThemedText type="code" style={styles.dim}>
                        {money(s.revenueCents)} · {s.orders} ord · {s.views30d} views
                      </ThemedText>
                    </View>
                  ))}
                </View>
              ) : null}

              {/* Recent orders */}
              <View style={styles.section}>
                <ThemedText type="code" style={styles.sectionLabel}>
                  RECENT ORDERS
                </ThemedText>
                {orders.length ? (
                  orders.slice(0, 12).map((o) => (
                    <View key={o.id} style={styles.orderRow}>
                      <View style={{ flex: 1 }}>
                        <ThemedText type="small" style={styles.white}>
                          {money(o.totalCents)}
                        </ThemedText>
                        <ThemedText type="code" style={styles.orderMeta}>
                          {new Date(o.createdAt).toLocaleDateString()} · {o.storeSlug ?? ''}
                        </ThemedText>
                      </View>
                      <View style={[styles.badge, o.status === 'shipped' || o.status === 'delivered' ? styles.badgeShip : undefined]}>
                        <ThemedText type="code" style={styles.badgeText}>
                          {STATUS_LABEL[o.status] ?? o.status}
                        </ThemedText>
                      </View>
                    </View>
                  ))
                ) : (
                  <ThemedText type="small" style={styles.dim}>
                    No orders yet — share your store to make the first sale.
                  </ThemedText>
                )}
              </View>
            </ScrollView>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { flex: 1, marginTop: Spacing.six, backgroundColor: BG, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: 'rgba(53,214,255,0.18)', overflow: 'hidden' },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.four, paddingVertical: Spacing.four },
  eyebrow: { color: GREEN, letterSpacing: 2 },
  close: { color: DIM },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.six },
  scroll: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
  cardRow: { flexDirection: 'row', gap: Spacing.three },
  card: { flex: 1, backgroundColor: 'rgba(53,214,255,0.05)', borderWidth: 1, borderColor: 'rgba(53,214,255,0.15)', borderRadius: 14, padding: Spacing.four, gap: Spacing.one },
  cardLabel: { color: DIM, fontSize: 10, letterSpacing: 1.5 },
  cardBig: { color: '#fff', fontSize: 26 },
  alert: { color: '#ffcf3f' },
  section: { gap: Spacing.two, marginTop: Spacing.two },
  sectionLabel: { color: GREEN, letterSpacing: 1.5, fontSize: 11 },
  storeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' },
  orderMeta: { color: DIM, fontSize: 11 },
  badge: { paddingHorizontal: Spacing.three, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' },
  badgeShip: { backgroundColor: 'rgba(53,214,255,0.18)' },
  badgeText: { color: '#fff', fontSize: 10, letterSpacing: 0.5 },
  white: { color: '#fff' },
  dim: { color: DIM },
});
