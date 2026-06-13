import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { apiUrl } from '@/lib/api';
import { type StudioPalette, useStudioPalette } from '@/lib/studio-palette';

// The store-launch paywall. A subscription is required to launch a store (free accounts
// browse + shop only); credit packs top up AI spend. Checkout happens in the browser via
// Stripe (web pricing) — Apple IAP for in-app purchase is a later, pricier path.
// Theme-aware via the shared Studio palette.

type Tier = { plan: string; label: string; priceCents: number; monthlyCredits: number; maxBrands: number; blurb: string };
type Pack = { id: string; credits: number; priceCents: number; label: string };
type Data = {
  entitlements: { plan: string; status: string; active: boolean };
  brandCount: number;
  tiers: Tier[];
  creditPacks: Pack[];
};

const money = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;

export function Paywall({
  visible,
  onClose,
  token,
  reason,
}: {
  visible: boolean;
  onClose: () => void;
  token: string;
  reason: 'subscription_required' | 'brand_limit' | 'manage' | null;
}) {
  const p = useStudioPalette();
  const s = useMemo(() => makeStyles(p), [p]);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(apiUrl('/api/creator/subscription'), { headers: { Authorization: `Bearer ${token}` } });
      setData((await r.json()) as Data);
    } catch {
      setNote('Could not load plans.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (visible) {
      setNote(null);
      void load();
    }
  }, [visible, load]);

  const checkout = async (body: object, key: string) => {
    setBusy(key);
    setNote(null);
    try {
      const r = await fetch(apiUrl('/api/creator/billing/checkout'), { method: 'POST', headers, body: JSON.stringify(body) });
      const d = (await r.json()) as { url?: string; error?: string };
      if (!r.ok || !d.url) {
        setNote(d.error === 'STRIPE_PRICE_STARTER not configured' || /not configured/.test(d.error ?? '') ? 'Billing isn’t configured yet.' : 'Could not start checkout.');
        return;
      }
      await WebBrowser.openBrowserAsync(d.url);
      // They finish in the browser; refresh on return so the new plan/credits show.
      await load();
    } catch {
      setNote('Could not start checkout.');
    } finally {
      setBusy(null);
    }
  };

  const title =
    reason === 'brand_limit'
      ? 'You’ve reached your brand limit'
      : reason === 'subscription_required'
        ? 'Launch your store'
        : 'Plans & credits';
  const sub =
    reason === 'brand_limit'
      ? 'Upgrade to add more brands. Your current brands stay live.'
      : reason === 'subscription_required'
        ? 'A subscription unlocks your storefront, feed, and shop. Browsing and buying are always free.'
        : 'Manage your plan or top up credits.';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <View style={s.sheet}>
          <View style={styles.headerRow}>
            <ThemedText type="code" style={s.eyebrow}>// PLANS</ThemedText>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose} hitSlop={12}>
              <ThemedText type="code" style={s.dim}>close ✕</ThemedText>
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator style={styles.center} color={p.accent} />
          ) : (
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
              <ThemedText type="title" style={s.ink}>{title}</ThemedText>
              <ThemedText type="small" style={s.dim}>{sub}</ThemedText>
              {note ? <ThemedText type="small" style={s.warn}>{note}</ThemedText> : null}

              {data?.tiers.map((t) => {
                const current = data.entitlements.active && data.entitlements.plan === t.plan;
                return (
                  <View key={t.plan} style={[s.card, current && s.cardCurrent]}>
                    <View style={styles.cardTop}>
                      <ThemedText type="subtitle" style={s.ink}>{t.label}</ThemedText>
                      <ThemedText type="subtitle" style={s.price}>{money(t.priceCents)}<ThemedText type="code" style={s.dim}>/mo</ThemedText></ThemedText>
                    </View>
                    <ThemedText type="small" style={s.dim}>{t.blurb}</ThemedText>
                    <ThemedText type="code" style={s.feat}>
                      {t.monthlyCredits.toLocaleString()} credits/mo · {t.maxBrands >= 99 ? 'unlimited brands' : `${t.maxBrands} brand${t.maxBrands > 1 ? 's' : ''}`}
                    </ThemedText>
                    {current ? (
                      <View style={[s.btn, s.btnCurrent]}>
                        <ThemedText type="smallBold" style={s.accent}>Current plan</ThemedText>
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => checkout({ kind: 'subscription', plan: t.plan }, t.plan)}
                        disabled={!!busy}
                        style={s.btn}
                      >
                        {busy === t.plan ? (
                          <ActivityIndicator size="small" color={p.onAccent} />
                        ) : (
                          <ThemedText type="smallBold" style={{ color: p.onAccent }}>
                            {data.entitlements.active ? 'Switch' : 'Subscribe'}
                          </ThemedText>
                        )}
                      </Pressable>
                    )}
                  </View>
                );
              })}

              <ThemedText type="code" style={[s.sectionLabel, { marginTop: Spacing.five }]}>CREDIT PACKS</ThemedText>
              <ThemedText type="small" style={s.dim}>Credits power video ads, designs, and revisions. Top up any time.</ThemedText>
              {data?.creditPacks.map((pk) => (
                <View key={pk.id} style={s.packRow}>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="small" style={s.ink}>{pk.label}</ThemedText>
                    <ThemedText type="code" style={s.dim}>{money(pk.priceCents)}</ThemedText>
                  </View>
                  <Pressable onPress={() => checkout({ kind: 'credit_pack', packId: pk.id }, pk.id)} disabled={!!busy} style={s.packBtn}>
                    {busy === pk.id ? <ActivityIndicator size="small" color={p.accent} /> : <ThemedText type="code" style={s.accent}>buy</ThemedText>}
                  </Pressable>
                </View>
              ))}

              <ThemedText type="code" style={s.fine}>
                Subscriptions and credits purchased on the web. Manage or cancel any time.
              </ThemedText>
            </ScrollView>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// Static (theme-independent) layout bits.
const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  headerRow: { flexDirection: 'row', alignItems: 'center', padding: Spacing.four, paddingBottom: Spacing.two },
  center: { paddingVertical: Spacing.six },
  scroll: { padding: Spacing.four, paddingTop: Spacing.two, gap: Spacing.three },
  cardTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
});

function makeStyles(p: StudioPalette) {
  return StyleSheet.create({
    sheet: { backgroundColor: p.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%', borderWidth: 1, borderColor: p.line },
    eyebrow: { color: p.accent, letterSpacing: 2 },
    ink: { color: p.ink },
    card: { borderRadius: 16, borderWidth: 1, borderColor: p.dark ? 'rgba(139,123,255,0.3)' : 'rgba(139,123,255,0.4)', backgroundColor: p.dark ? 'rgba(139,123,255,0.06)' : 'rgba(139,123,255,0.08)', padding: Spacing.four, gap: Spacing.two },
    cardCurrent: { borderColor: p.accent, backgroundColor: p.card },
    price: { color: p.accent2 },
    feat: { color: p.accent, fontSize: 11, letterSpacing: 0.3 },
    btn: { marginTop: Spacing.two, backgroundColor: p.accent, borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center' },
    btnCurrent: { backgroundColor: 'transparent', borderWidth: 1, borderColor: p.accent },
    sectionLabel: { color: p.accent, letterSpacing: 1.5, fontSize: 11 },
    packRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.line },
    packBtn: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, borderRadius: 999, borderWidth: 1, borderColor: p.line },
    accent: { color: p.accent },
    dim: { color: p.dim },
    warn: { color: p.warn },
    fine: { color: p.dim, fontSize: 10, marginTop: Spacing.three, textAlign: 'center', opacity: 0.8 },
  });
}
