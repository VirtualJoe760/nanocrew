import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, apiFetch, readJson } from '@/lib/api';

// The buyer's "Purchases" surface — the signed-in account's own orders across every brand they've
// bought from (GET /api/customer/orders), mirrored on the earnings-cockpit modal pattern. Each
// order shows status, tracking, and its items; while the 7-day claim window is open
// (`canRequestReturn`) the buyer can open a defect/wrong/damaged/not-received return claim
// (POST /api/customer/returns → platform-api). Monochrome APP chrome (theme.ts Colors), NOT brand
// colors — this is account, not storefront.

type Theme = ReturnType<typeof useTheme>;

type PurchaseItem = { name?: string; variant?: string | null; quantity?: number };
type PurchaseOrder = {
  id: string;
  storeSlug?: string | null;
  storeName?: string | null;
  status: string;
  totalCents: number;
  createdAt: string;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  items?: PurchaseItem[];
  canRequestReturn?: boolean;
  returnWindowEndsAt?: string | null;
  returnStatus?: string | null; // when a claim already exists: requested | approved | declined | refunded
};

type ReturnReason = 'defective' | 'wrong_item' | 'damaged' | 'not_received';
const REASONS: { key: ReturnReason; label: string }[] = [
  { key: 'defective', label: 'Defective' },
  { key: 'wrong_item', label: 'Wrong item' },
  { key: 'damaged', label: 'Damaged in transit' },
  { key: 'not_received', label: 'Never arrived' },
];

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Buyer-facing status copy — friendlier than the raw order_status enum.
const STATUS_LABEL: Record<string, string> = {
  pending_payment: 'Awaiting payment',
  paid: 'Confirmed',
  submitted_to_printful: 'Preparing',
  in_production: 'In production',
  shipped: 'Shipped',
  delivered: 'Delivered',
  return_requested: 'Return requested',
  returned: 'Returned',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

export function Purchases({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [returnFor, setReturnFor] = useState<PurchaseOrder | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await readJson<{ orders?: PurchaseOrder[] }>(await apiFetch('/api/customer/orders'));
      setOrders(d.orders ?? []);
    } catch {
      setError('Could not load your purchases — try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!visible) return;
    void load();
     
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <ThemedText type="code" style={styles.eyebrow}>
              {'// PURCHASES'}
            </ThemedText>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose} hitSlop={12}>
              <ThemedText type="code" themeColor="textSecondary">
                close ✕
              </ThemedText>
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator style={styles.center} color={theme.tint} />
          ) : error ? (
            <View style={styles.center}>
              <ThemedText type="small" themeColor="textSecondary">
                {error}
              </ThemedText>
              <Pressable onPress={() => void load()} hitSlop={8}>
                <ThemedText type="smallBold" themeColor="tint" style={styles.retry}>
                  Retry
                </ThemedText>
              </Pressable>
            </View>
          ) : !orders.length ? (
            <View style={styles.center}>
              <ThemedText type="subtitle">No purchases yet</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptySub}>
                Orders you place from any Nano Crew brand show up here — with tracking and returns.
              </ThemedText>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
              {orders.map((o) => (
                <OrderCard key={o.id} order={o} theme={theme} styles={styles} onReturn={() => setReturnFor(o)} />
              ))}
            </ScrollView>
          )}
        </View>
      </SafeAreaView>

      {returnFor ? (
        <ReturnForm
          order={returnFor}
          theme={theme}
          styles={styles}
          onClose={() => setReturnFor(null)}
          onDone={() => {
            setReturnFor(null);
            void load(); // refresh so the order flips to "Return requested"
          }}
        />
      ) : null}
    </Modal>
  );
}

function OrderCard({
  order,
  theme,
  styles,
  onReturn,
}: {
  order: PurchaseOrder;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
  onReturn: () => void;
}) {
  const shipped = order.status === 'shipped' || order.status === 'delivered';
  const items = order.items ?? [];
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {order.storeName || order.storeSlug || 'Order'}
          </ThemedText>
          <ThemedText type="code" themeColor="textSecondary" style={styles.meta}>
            {new Date(order.createdAt).toLocaleDateString()} · {money(order.totalCents)}
          </ThemedText>
        </View>
        <View style={[styles.badge, shipped ? styles.badgeShip : undefined]}>
          <ThemedText type="code" style={styles.badgeText}>
            {STATUS_LABEL[order.status] ?? order.status}
          </ThemedText>
        </View>
      </View>

      {items.length ? (
        <View style={styles.items}>
          {items.map((it, i) => (
            <ThemedText key={i} type="small" themeColor="textSecondary" numberOfLines={1}>
              {it.quantity && it.quantity > 1 ? `${it.quantity}× ` : ''}
              {it.name ?? 'Item'}
              {it.variant ? ` — ${it.variant}` : ''}
            </ThemedText>
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        {order.trackingUrl ? (
          <Pressable onPress={() => Linking.openURL(order.trackingUrl!).catch(() => {})} hitSlop={6}>
            <ThemedText type="smallBold" themeColor="tint" style={styles.link}>
              Track shipment ↗
            </ThemedText>
          </Pressable>
        ) : order.trackingNumber ? (
          <ThemedText type="code" themeColor="textSecondary">
            Tracking {order.trackingNumber}
          </ThemedText>
        ) : (
          <View />
        )}

        {order.returnStatus ? (
          <ThemedText type="code" themeColor="textSecondary">
            Return {order.returnStatus}
          </ThemedText>
        ) : order.canRequestReturn ? (
          <Pressable onPress={onReturn} hitSlop={6}>
            <ThemedText type="smallBold" style={[styles.link, { color: theme.text }]}>
              Request a return
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function ReturnForm({
  order,
  theme,
  styles,
  onClose,
  onDone,
}: {
  order: PurchaseOrder;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState<ReturnReason | null>(null);
  const [photos, setPhotos] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const needsPhoto = reason === 'defective' || reason === 'damaged';
  const photoUrls = photos
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//.test(s));

  const submit = async () => {
    if (busy) return;
    if (!reason) {
      setErr('Pick a reason for the return.');
      return;
    }
    if (needsPhoto && !photoUrls.length) {
      setErr('Add at least one photo URL so the brand can verify the issue.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch('/api/customer/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, reason, photoUrls, note: note.trim() || undefined }),
      });
      await readJson(res);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not submit your return — try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <ThemedText type="code" style={styles.eyebrow}>
              {'// REQUEST A RETURN'}
            </ThemedText>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose} hitSlop={12}>
              <ThemedText type="code" themeColor="textSecondary">
                cancel ✕
              </ThemedText>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.formIntro}>
              {order.storeName || order.storeSlug || 'This order'} · {money(order.totalCents)}. Returns cover items that
              arrived defective, wrong, damaged, or never arrived.
            </ThemedText>

            <ThemedText type="code" style={styles.formLabel}>
              REASON
            </ThemedText>
            <View style={styles.reasons}>
              {REASONS.map((r) => {
                const active = reason === r.key;
                return (
                  <Pressable
                    key={r.key}
                    onPress={() => setReason(r.key)}
                    style={[
                      styles.chip,
                      { borderColor: active ? theme.text : `${theme.textSecondary}55`, backgroundColor: active ? theme.text : 'transparent' },
                    ]}>
                    <ThemedText type="small" style={{ color: active ? theme.background : theme.text }}>
                      {r.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            <ThemedText type="code" style={styles.formLabel}>
              PHOTOS {needsPhoto ? '(required)' : '(optional)'}
            </ThemedText>
            <TextInput
              value={photos}
              onChangeText={setPhotos}
              placeholder="Paste photo URLs, separated by spaces"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              style={[styles.input, styles.inputMulti, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />

            <ThemedText type="code" style={styles.formLabel}>
              NOTE (optional)
            </ThemedText>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Tell the brand what went wrong"
              placeholderTextColor={theme.textSecondary}
              multiline
              style={[styles.input, styles.inputMulti, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />

            {err ? (
              <ThemedText type="small" style={styles.err}>
                {err}
              </ThemedText>
            ) : null}

            <Pressable onPress={submit} disabled={busy}>
              <View style={[styles.submit, { backgroundColor: theme.text, opacity: busy ? 0.5 : 1 }]}>
                {busy ? (
                  <ActivityIndicator color={theme.background} />
                ) : (
                  <ThemedText type="smallBold" style={{ color: theme.background }}>
                    Submit return request
                  </ThemedText>
                )}
              </View>
            </Pressable>
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    fill: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
    sheet: {
      flex: 1,
      marginTop: Spacing.six,
      backgroundColor: theme.background,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      borderWidth: 1,
      borderColor: `${theme.textSecondary}33`,
      overflow: 'hidden',
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.four, paddingVertical: Spacing.four },
    eyebrow: { color: theme.tint, letterSpacing: 2 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.six },
    emptySub: { textAlign: 'center', maxWidth: 280, lineHeight: 20 },
    retry: { marginTop: Spacing.two, textDecorationLine: 'underline' },
    scroll: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },

    // Order card
    card: {
      backgroundColor: theme.backgroundElement,
      borderWidth: 1,
      borderColor: `${theme.textSecondary}22`,
      borderRadius: 14,
      padding: Spacing.four,
      gap: Spacing.three,
    },
    cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
    meta: { fontSize: 11, marginTop: 2 },
    items: { gap: 2 },
    actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
    link: { textDecorationLine: 'underline' },
    badge: { paddingHorizontal: Spacing.three, paddingVertical: 4, borderRadius: 999, backgroundColor: theme.backgroundSelected },
    badgeShip: { backgroundColor: `${theme.tint}26` },
    badgeText: { color: theme.text, fontSize: 10, letterSpacing: 0.5 },

    // Return form
    formIntro: { lineHeight: 20, marginBottom: Spacing.two },
    formLabel: { color: theme.tint, letterSpacing: 1.5, fontSize: 11, marginTop: Spacing.three, marginBottom: Spacing.two },
    reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
    chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
    input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, fontSize: 15 },
    inputMulti: { minHeight: 64, textAlignVertical: 'top' },
    err: { color: '#e24b4a', marginTop: Spacing.three },
    submit: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.three, borderRadius: Spacing.three, minHeight: 48, marginTop: Spacing.four },
  });
}
