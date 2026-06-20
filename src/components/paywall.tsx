import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { Image } from 'expo-image';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { apiUrl } from '@/lib/api';
import { iapDetail, iapReady, purchaseInApp } from '@/lib/iap';
import { creditProductId, planProductId } from '@/lib/iap-products';
import { type StudioPalette, useStudioPalette } from '@/lib/studio-palette';

// The store-launch paywall. A subscription is required to launch a store (free accounts
// browse + shop only); credit packs top up AI spend. Checkout happens in the browser via
// Stripe (web pricing) — Apple IAP for in-app purchase is a later, pricier path.
// Theme-aware via the shared Studio palette.

type Tier = { plan: string; label: string; priceCents: number; monthlyCredits: number; maxBrands: number; website: boolean; creditRateMultiplier: number; blurb: string };
type Pack = { id: string; credits: number; priceCents: number; label: string };
type Data = {
  entitlements: { plan: string; status: string; active: boolean; creditRateMultiplier?: number };
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
  onFreeSlot,
}: {
  visible: boolean;
  onClose: () => void;
  token: string;
  reason: 'subscription_required' | 'brand_limit' | 'manage' | null;
  /** brand_limit only: "free up a slot" → caller takes the user to their brands to delete one. */
  onFreeSlot?: () => void;
}) {
  const p = useStudioPalette();
  const s = useMemo(() => makeStyles(p), [p]);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // On iOS, Apple requires digital goods to use IAP — we use it whenever it's ready (native module
  // present + App Store products live), and fall back to web Stripe otherwise.
  const [iapOn, setIapOn] = useState(false);
  const [iapNote, setIapNote] = useState<string | null>(null); // diagnostic: why IAP did/didn't engage

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(apiUrl('/api/creator/subscription'), { headers: { Authorization: `Bearer ${token}` } });
      const d = (await r.json().catch(() => null)) as (Data & { error?: string }) | null;
      // Only accept a well-formed payload — never let an error object reach the render
      // (it has no `tiers`/`creditPacks` arrays, which used to crash the screen).
      if (!r.ok || !d || !Array.isArray(d.tiers) || !Array.isArray(d.creditPacks)) {
        setData(null);
        setNote('Could not load plans. Please try again.');
      } else {
        setData(d);
      }
    } catch {
      setData(null);
      setNote('Could not load plans. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (visible) {
      setNote(null);
      void load();
      void iapReady().then((r) => {
        setIapOn(r);
        if (Platform.OS === 'ios') setIapNote(iapDetail());
      });
    }
  }, [visible, load]);

  // Subscribe / switch to a plan. iOS → Apple IAP (subscription); web/Android or IAP failure →
  // web Stripe Checkout. A user cancelling IAP just aborts (no fallback browser pop).
  const subscribe = async (plan: string) => {
    if (busy) return;
    if (iapOn) {
      setBusy(plan);
      setNote(null);
      const r = await purchaseInApp({ productId: planProductId(plan as 'starter' | 'pro' | 'advanced'), isSubscription: true, token });
      setBusy(null);
      if (r.ok) { await load(); return; }
      if (r.error === 'cancelled') return;
      // fall through to web on any IAP error
    }
    await checkout({ kind: 'subscription', plan }, plan);
  };

  // Buy a credit pack. iOS → Apple IAP (consumable); else web Stripe.
  const buyPack = async (pk: Pack) => {
    if (busy) return;
    const productId = creditProductId(pk.credits);
    if (iapOn && productId) {
      setBusy(pk.id);
      setNote(null);
      const r = await purchaseInApp({ productId, isSubscription: false, token });
      setBusy(null);
      if (r.ok) { await load(); return; }
      if (r.error === 'cancelled') return;
    }
    await checkout({ kind: 'credit_pack', packId: pk.id }, pk.id);
  };

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

  // Stripe billing portal — manage card, invoices, or cancel. Only meaningful once they have a
  // real Stripe customer (i.e. an active paid subscription bought through checkout).
  const openPortal = async () => {
    if (busy) return;
    setBusy('portal');
    setNote(null);
    try {
      const r = await fetch(apiUrl('/api/creator/billing/portal'), { method: 'POST', headers });
      const d = (await r.json()) as { url?: string; error?: string };
      if (r.ok && d.url) {
        await WebBrowser.openBrowserAsync(d.url);
        await load();
        return;
      }
      setNote(d.error === 'no_billing_account' ? 'No billing account yet — subscribe first.' : 'Could not open billing.');
    } catch {
      setNote('Could not open billing.');
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
        ? 'Starter sells in the Nano Crew app; Pro adds your own website + domain. Browsing and buying are always free.'
        : 'Manage your plan or top up credits.';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <View style={s.sheet}>
          <View style={styles.headerRow}>
            <Image source={require('../assets/brand/nc-mark.png')} style={styles.brandMark} contentFit="contain" tintColor={p.ink} />
            <ThemedText type="code" style={[s.eyebrow, { marginLeft: Spacing.two }]}>PLANS &amp; CREDITS</ThemedText>
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

              {reason === 'brand_limit' && onFreeSlot ? (
                <Pressable onPress={onFreeSlot} style={[s.btn, s.btnCurrent]}>
                  <ThemedText type="smallBold" style={s.accent}>Free up a slot — delete a brand</ThemedText>
                </Pressable>
              ) : null}

              {data?.tiers?.map((t) => {
                const current = data.entitlements.active && data.entitlements.plan === t.plan;
                return (
                  <View key={t.plan} style={[s.card, current && s.cardCurrent]}>
                    <View style={styles.cardTop}>
                      <ThemedText type="subtitle" style={s.ink}>{t.label}</ThemedText>
                      <ThemedText type="subtitle" style={s.price}>{money(t.priceCents)}<ThemedText type="code" style={s.dim}>/mo</ThemedText></ThemedText>
                    </View>
                    <ThemedText type="small" style={s.dim}>{t.blurb}</ThemedText>
                    <ThemedText type="code" style={s.feat}>
                      {[
                        `${t.monthlyCredits.toLocaleString()} credits/mo`,
                        t.maxBrands >= 99 ? 'unlimited brands' : `${t.maxBrands} brand${t.maxBrands > 1 ? 's' : ''}`,
                        t.website ? 'website + custom domain' : 'in-app store',
                        t.creditRateMultiplier < 1 ? `${Math.round((1 - t.creditRateMultiplier) * 100)}% off credit top-ups` : null,
                      ].filter(Boolean).join(' · ')}
                    </ThemedText>
                    {current ? (
                      <View style={[s.btn, s.btnCurrent]}>
                        <ThemedText type="smallBold" style={s.accent}>Current plan</ThemedText>
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => subscribe(t.plan)}
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
              {data?.creditPacks?.map((pk) => {
                const mult = data.entitlements.creditRateMultiplier ?? 1;
                const yourPrice = Math.round(pk.priceCents * mult);
                return (
                <View key={pk.id} style={s.packRow}>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="small" style={s.ink}>{pk.label}</ThemedText>
                    <ThemedText type="code" style={s.dim}>
                      {money(yourPrice)}{mult < 1 ? ` · ${Math.round((1 - mult) * 100)}% off (your rate)` : ''}
                    </ThemedText>
                  </View>
                  <Pressable onPress={() => buyPack(pk)} disabled={!!busy} style={s.packBtn}>
                    {busy === pk.id ? <ActivityIndicator size="small" color={p.accent} /> : <ThemedText type="code" style={s.accent}>buy</ThemedText>}
                  </Pressable>
                </View>
                );
              })}

              {data?.entitlements.active ? (
                <Pressable onPress={openPortal} disabled={!!busy} style={s.manageBtn}>
                  {busy === 'portal' ? (
                    <ActivityIndicator size="small" color={p.accent} />
                  ) : (
                    <ThemedText type="smallBold" style={s.accent}>Manage billing in Stripe ↗</ThemedText>
                  )}
                </Pressable>
              ) : null}

              <ThemedText type="code" style={s.fine}>
                {iapOn
                  ? 'Purchases handled by the App Store. Manage or cancel anytime in Settings.'
                  : 'Subscriptions and credits purchased on the web. Manage or cancel any time.'}
              </ThemedText>
              {iapNote ? <ThemedText type="code" style={s.fine}>IAP status: {iapNote}</ThemedText> : null}
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
  brandMark: { width: 30, height: 26 },
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
    manageBtn: { marginTop: Spacing.four, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.three, borderRadius: 999, borderWidth: 1, borderColor: p.line, minHeight: 44 },
    accent: { color: p.accent },
    dim: { color: p.dim },
    warn: { color: p.warn },
    fine: { color: p.dim, fontSize: 10, marginTop: Spacing.three, textAlign: 'center', opacity: 0.8 },
  });
}
