import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { apiUrl } from '@/lib/api';
import { type StudioPalette, useStudioPalette } from '@/lib/studio-palette';

// The creator's business cockpit — revenue, orders, traffic, recent activity.
// Reads the same authed endpoints the brand-site /admin uses (/api/creator/*).
// Venus can speak a summary; this is the visual surface. Theme-aware.

type StoreStat = { id: string; slug: string; name: string; orders: number; revenueCents: number; views30d: number };
type OrderRow = { id: string; storeSlug?: string; status: string; totalCents: number; createdAt: string; trackingUrl: string | null };
type MarginRow = { productId: string; name: string; storeName: string; retailCents: number | null; costCents: number | null; marginCents: number | null; marginPct: number | null };

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
  const pal = useStudioPalette();
  const styles = useMemo(() => makeStyles(pal), [pal]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stores, setStores] = useState<StoreStat[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [margins, setMargins] = useState<MarginRow[]>([]);
  const [avgMarginPct, setAvgMarginPct] = useState<number | null>(null);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const [s, o, m] = await Promise.all([
          fetch(apiUrl('/api/creator/stats'), { headers }).then((r) => r.json()),
          fetch(apiUrl('/api/creator/orders'), { headers }).then((r) => r.json()),
          fetch(apiUrl('/api/creator/margins'), { headers }).then((r) => r.json()),
        ]);
        if (!alive) return;
        setStores(s.stores ?? []);
        setOrders(o.orders ?? []);
        setMargins(m.products ?? []);
        setAvgMarginPct(typeof m.avgMarginPct === 'number' ? m.avgMarginPct : null);
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
            <ActivityIndicator style={styles.center} color={pal.accent} />
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

              {/* Per-product margin — retail vs our Printful cost */}
              {margins.length ? (
                <View style={styles.section}>
                  <View style={styles.marginHead}>
                    <ThemedText type="code" style={styles.sectionLabel}>MARGINS</ThemedText>
                    {avgMarginPct != null ? (
                      <ThemedText type="code" style={styles.dim}>avg {avgMarginPct}%</ThemedText>
                    ) : null}
                  </View>
                  {margins.map((m) => (
                    <View key={m.productId} style={styles.marginRow}>
                      <View style={{ flex: 1 }}>
                        <ThemedText type="small" style={styles.white} numberOfLines={1}>{m.name}</ThemedText>
                        <ThemedText type="code" style={styles.orderMeta}>
                          {m.retailCents != null ? money(m.retailCents) : '—'} retail
                          {m.costCents != null ? ` · ${money(m.costCents)} cost` : ''}
                        </ThemedText>
                      </View>
                      {m.marginCents != null ? (
                        <View style={{ alignItems: 'flex-end' }}>
                          <ThemedText type="small" style={styles.profit}>{money(m.marginCents)}</ThemedText>
                          {m.marginPct != null ? <ThemedText type="code" style={styles.orderMeta}>{m.marginPct}%</ThemedText> : null}
                        </View>
                      ) : (
                        <ThemedText type="code" style={styles.dim}>cost n/a</ThemedText>
                      )}
                    </View>
                  ))}
                </View>
              ) : null}
            </ScrollView>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function makeStyles(pal: StudioPalette) {
  return StyleSheet.create({
    fill: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
    sheet: { flex: 1, marginTop: Spacing.six, backgroundColor: pal.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: pal.line, overflow: 'hidden' },
    headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.four, paddingVertical: Spacing.four },
    eyebrow: { color: pal.accent, letterSpacing: 2 },
    close: { color: pal.dim },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.six },
    scroll: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
    cardRow: { flexDirection: 'row', gap: Spacing.three },
    card: { flex: 1, backgroundColor: pal.card, borderWidth: 1, borderColor: pal.line, borderRadius: 14, padding: Spacing.four, gap: Spacing.one },
    cardLabel: { color: pal.dim, fontSize: 10, letterSpacing: 1.5 },
    cardBig: { color: pal.ink, fontSize: 26 },
    alert: { color: pal.accent },
    section: { gap: Spacing.two, marginTop: Spacing.two },
    sectionLabel: { color: pal.accent, letterSpacing: 1.5, fontSize: 11 },
    storeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: pal.line },
    orderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: pal.line },
    orderMeta: { color: pal.dim, fontSize: 11 },
    marginHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    marginRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: pal.line },
    profit: { color: pal.dark ? '#4ade80' : '#16a34a', fontWeight: '700' },
    badge: { paddingHorizontal: Spacing.three, paddingVertical: 4, borderRadius: 999, backgroundColor: pal.card },
    badgeShip: { backgroundColor: pal.dark ? 'rgba(205,209,217,0.18)' : 'rgba(68,71,78,0.14)' },
    badgeText: { color: pal.ink, fontSize: 10, letterSpacing: 0.5 },
    white: { color: pal.ink },
    dim: { color: pal.dim },
  });
}
