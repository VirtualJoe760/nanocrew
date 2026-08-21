import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { apiUrl, readJson } from '@/lib/api';
import { type StudioPalette, useStudioPalette } from '@/lib/studio-palette';

// The creator's Returns inbox — every return claim across their stores, newest first.
// Reads GET /api/creator/returns (the same authed endpoint shape as the brand-site /admin),
// and resolves a claim with Approve (→ refund via the shared path) or Decline (with a reason).
// Mirrors EarningsCockpit's Modal + status-badge-row idiom. Theme-aware (monochrome Studio palette).

// Matches the GET /api/creator/returns row shape (Workstream B): the claim joined with a small
// order summary so the card renders without a second round-trip.
type ReturnRow = {
  id: string;
  orderId: string;
  storeId: string;
  customerEmail: string;
  reason: 'defective' | 'wrong_item' | 'damaged' | 'not_received';
  itemsJson: unknown;
  photoUrls: string[] | null;
  note: string | null;
  status: 'requested' | 'approved' | 'declined' | 'refunded';
  resolution: string | null;
  refundId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  orderStatus: string;
  orderTotalCents: number;
  orderCreatedAt: string;
};

const money = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// An order id is a UUID — show a short, stable handle the creator can cross-reference.
const orderHandle = (orderId: string) => `#${orderId.slice(0, 8)}`;

const REASON_LABEL: Record<ReturnRow['reason'], string> = {
  defective: 'Defective / misprint',
  wrong_item: 'Wrong item',
  damaged: 'Damaged in transit',
  not_received: 'Never arrived',
};

const STATUS_LABEL: Record<ReturnRow['status'], string> = {
  requested: 'needs review',
  approved: 'approved',
  declined: 'declined',
  refunded: 'refunded',
};

export function ReturnsInbox({ visible, onClose, token }: { visible: boolean; onClose: () => void; token: string }) {
  const pal = useStudioPalette();
  const styles = useMemo(() => makeStyles(pal), [pal]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null); // claim currently being approved/declined
  const [note, setNote] = useState<string | null>(null);
  const [declining, setDeclining] = useState<ReturnRow | null>(null); // claim whose decline-reason form is open
  const [reason, setReason] = useState('');

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const r = await fetch(apiUrl('/api/creator/returns'), { headers: { Authorization: `Bearer ${token}` } });
        const d = await readJson<{ returns?: ReturnRow[] }>(r);
        setReturns(d.returns ?? []);
      } catch {
        setError('Could not load your returns — try again.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (!visible) return;
    setNote(null);
    setDeclining(null);
    void load();
  }, [visible, load]);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const approve = async (claim: ReturnRow) => {
    if (busyId) return;
    setBusyId(claim.id);
    setNote(null);
    try {
      const res = await fetch(apiUrl(`/api/creator/returns/${claim.id}/approve`), { method: 'POST', headers });
      const d = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setNote(d?.error ?? 'Could not approve — the customer was not refunded.');
        return;
      }
      await load(true);
    } catch {
      setNote('Could not approve — the customer was not refunded.');
    } finally {
      setBusyId(null);
    }
  };

  // Approving issues a real refund to the buyer — confirm before moving money.
  const confirmApprove = (claim: ReturnRow) =>
    Alert.alert(
      'Approve this return?',
      `${money(claim.orderTotalCents)} is refunded to ${claim.customerEmail} in full. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Approve & refund', style: 'destructive', onPress: () => void approve(claim) },
      ],
    );

  const decline = async (claim: ReturnRow) => {
    if (busyId) return;
    setBusyId(claim.id);
    setNote(null);
    try {
      const trimmed = reason.trim();
      const res = await fetch(apiUrl(`/api/creator/returns/${claim.id}/decline`), {
        method: 'POST',
        headers,
        body: JSON.stringify(trimmed ? { reason: trimmed } : {}),
      });
      const d = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setNote(d?.error ?? 'Could not decline this claim.');
        return;
      }
      setDeclining(null);
      setReason('');
      await load(true);
    } catch {
      setNote('Could not decline this claim.');
    } finally {
      setBusyId(null);
    }
  };

  const openDecline = (claim: ReturnRow) => {
    setNote(null);
    setReason('');
    setDeclining(claim);
  };

  const pending = returns.filter((r) => r.status === 'requested').length;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <ThemedText type="code" style={styles.eyebrow}>
              {'// RETURNS'}
            </ThemedText>
            {pending ? (
              <View style={styles.pendingPill}>
                <ThemedText type="code" style={styles.pendingPillText}>
                  {pending} to review
                </ThemedText>
              </View>
            ) : null}
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
            <View style={styles.center}>
              <ThemedText style={styles.dim}>{error}</ThemedText>
              <Pressable onPress={() => void load()} style={styles.retryBtn}>
                <ThemedText type="smallBold" style={{ color: pal.onAccent }}>
                  Try again
                </ThemedText>
              </Pressable>
            </View>
          ) : !returns.length ? (
            <View style={styles.center}>
              <ThemedText type="subtitle" style={styles.white}>
                No returns
              </ThemedText>
              <ThemedText type="small" style={styles.dim}>
                When a customer opens a return claim, it lands here for your review.
              </ThemedText>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
              {note ? <ThemedText type="small" style={styles.warn}>{note}</ThemedText> : null}
              {returns.map((claim) => {
                const open = claim.status === 'requested';
                const photos = Array.isArray(claim.photoUrls) ? claim.photoUrls : [];
                const isBusy = busyId === claim.id;
                const isDeclining = declining?.id === claim.id;
                return (
                  <View key={claim.id} style={styles.card}>
                    {/* Header: order handle + amount + status badge */}
                    <View style={styles.cardTop}>
                      <View style={{ flex: 1 }}>
                        <ThemedText type="smallBold" style={styles.white}>
                          {orderHandle(claim.orderId)} · {money(claim.orderTotalCents)}
                        </ThemedText>
                        <ThemedText type="code" style={styles.meta}>
                          {new Date(claim.createdAt).toLocaleDateString()} · {claim.customerEmail}
                        </ThemedText>
                      </View>
                      <View
                        style={[
                          styles.badge,
                          claim.status === 'refunded' || claim.status === 'approved' ? styles.badgeDone : undefined,
                          claim.status === 'declined' ? styles.badgeDeclined : undefined,
                        ]}
                      >
                        <ThemedText type="code" style={styles.badgeText}>
                          {STATUS_LABEL[claim.status]}
                        </ThemedText>
                      </View>
                    </View>

                    {/* Reason + the customer's note */}
                    <ThemedText type="small" style={styles.reason}>
                      {REASON_LABEL[claim.reason]}
                    </ThemedText>
                    {claim.note ? (
                      <ThemedText type="small" style={styles.dim}>
                        “{claim.note}”
                      </ThemedText>
                    ) : null}

                    {/* Evidence photos — tap to open full-size */}
                    {photos.length ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
                        {photos.map((url, i) => (
                          <Pressable key={`${claim.id}-${i}`} onPress={() => void Linking.openURL(url)}>
                            <Image source={{ uri: url }} style={styles.photo} contentFit="cover" />
                          </Pressable>
                        ))}
                      </ScrollView>
                    ) : null}

                    {/* The brand's resolution note, once resolved */}
                    {!open && claim.resolution ? (
                      <ThemedText type="code" style={styles.resolution}>
                        {claim.resolution}
                      </ThemedText>
                    ) : null}

                    {/* Actions on an open claim */}
                    {open ? (
                      isDeclining ? (
                        <View style={styles.declineForm}>
                          <TextInput
                            style={styles.input}
                            placeholder="Reason (optional — the customer sees this)"
                            placeholderTextColor={pal.dim}
                            value={reason}
                            onChangeText={setReason}
                            multiline
                          />
                          <View style={styles.actions}>
                            <Pressable onPress={() => { setDeclining(null); setReason(''); }} hitSlop={8} disabled={isBusy}>
                              <ThemedText type="code" style={styles.dim}>cancel</ThemedText>
                            </Pressable>
                            <View style={{ flex: 1 }} />
                            {isBusy ? (
                              <ActivityIndicator size="small" color={pal.accent} />
                            ) : (
                              <Pressable onPress={() => void decline(claim)} style={styles.declineBtn}>
                                <ThemedText type="smallBold" style={styles.declineBtnText}>Confirm decline</ThemedText>
                              </Pressable>
                            )}
                          </View>
                        </View>
                      ) : (
                        <View style={styles.actions}>
                          {isBusy ? (
                            <ActivityIndicator size="small" color={pal.accent} />
                          ) : (
                            <>
                              <Pressable onPress={() => openDecline(claim)} hitSlop={8} style={styles.ghostBtn}>
                                <ThemedText type="code" style={styles.warn}>Decline</ThemedText>
                              </Pressable>
                              <View style={{ flex: 1 }} />
                              <Pressable onPress={() => confirmApprove(claim)} style={styles.approveBtn}>
                                <ThemedText type="smallBold" style={{ color: pal.onAccent }}>Approve &amp; refund</ThemedText>
                              </Pressable>
                            </>
                          )}
                        </View>
                      )
                    ) : null}
                  </View>
                );
              })}
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
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four, paddingVertical: Spacing.four },
    eyebrow: { color: pal.accent, letterSpacing: 2 },
    pendingPill: { paddingHorizontal: Spacing.three, paddingVertical: 3, borderRadius: 999, backgroundColor: pal.accent },
    pendingPillText: { color: pal.onAccent, fontSize: 10, letterSpacing: 0.5 },
    close: { color: pal.dim },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.six },
    retryBtn: { backgroundColor: pal.accent, borderRadius: 10, paddingVertical: Spacing.two, paddingHorizontal: Spacing.four, marginTop: Spacing.two },
    scroll: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
    card: { backgroundColor: pal.card, borderWidth: 1, borderColor: pal.line, borderRadius: 14, padding: Spacing.four, gap: Spacing.two },
    cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
    meta: { color: pal.dim, fontSize: 11, marginTop: 2 },
    reason: { color: pal.ink, fontWeight: '600' },
    resolution: { color: pal.dim, fontSize: 11, marginTop: Spacing.one },
    photoRow: { gap: Spacing.two, paddingVertical: Spacing.one },
    photo: { width: 64, height: 64, borderRadius: 8, backgroundColor: pal.surface, borderWidth: 1, borderColor: pal.line },
    actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, marginTop: Spacing.one },
    ghostBtn: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: 999, borderWidth: 1, borderColor: pal.line },
    approveBtn: { backgroundColor: pal.accent, borderRadius: 10, paddingVertical: Spacing.two, paddingHorizontal: Spacing.four, alignItems: 'center' },
    declineForm: { gap: Spacing.two, marginTop: Spacing.one },
    declineBtn: { borderWidth: 1, borderColor: 'rgba(226,75,74,0.5)', borderRadius: 10, paddingVertical: Spacing.two, paddingHorizontal: Spacing.four },
    declineBtnText: { color: '#e24b4a' },
    input: { borderWidth: 1, borderColor: pal.line, backgroundColor: pal.field, borderRadius: 10, padding: Spacing.three, color: pal.ink, fontSize: 14, minHeight: 60, textAlignVertical: 'top' },
    badge: { paddingHorizontal: Spacing.three, paddingVertical: 4, borderRadius: 999, backgroundColor: pal.card, borderWidth: 1, borderColor: pal.line },
    badgeDone: { backgroundColor: pal.dark ? 'rgba(205,209,217,0.18)' : 'rgba(68,71,78,0.14)' },
    badgeDeclined: { backgroundColor: 'rgba(226,75,74,0.14)', borderColor: 'rgba(226,75,74,0.4)' },
    badgeText: { color: pal.ink, fontSize: 10, letterSpacing: 0.5 },
    white: { color: pal.ink },
    dim: { color: pal.dim },
    warn: { color: pal.warn },
  });
}
