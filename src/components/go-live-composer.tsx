import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { apiUrl } from '@/lib/api';
import { type StudioPalette, useStudioPalette } from '@/lib/studio-palette';

// Go live: point the storefront at a custom domain. Two paths — attach/transfer a domain the creator
// already owns (Vercel returns DNS records to set, verifies on re-check), or buy a new one with credits.
// "Live" == a domain is attached (Phase C); until then the site lives on store-<slug>.vercel.app.

type DnsRecord = { type: string; domain: string; value: string; reason?: string };
type StoreInfo = { status: string; customDomain: string | null; deploymentUrl: string | null };
type Offer = { domain: string; available: boolean; priceUsd: number | null; credits: number | null };
type Mode = 'own' | 'buy';

export function GoLiveComposer({
  visible,
  onClose,
  token,
  slug,
  onLive,
}: {
  visible: boolean;
  onClose: () => void;
  token: string;
  slug: string;
  onLive?: () => void;
}) {
  const pal = useStudioPalette();
  const styles = useMemo(() => makeStyles(pal), [pal]);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const [info, setInfo] = useState<StoreInfo | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>('own');
  const [loading, setLoading] = useState(true);

  // Own-domain path
  const [domain, setDomain] = useState('');
  const [records, setRecords] = useState<DnsRecord[] | null>(null);
  const [attaching, setAttaching] = useState(false);

  // Buy path
  const [query, setQuery] = useState('');
  const [offer, setOffer] = useState<Offer | null>(null);
  const [searching, setSearching] = useState(false);
  const [buying, setBuying] = useState(false);

  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, cRes] = await Promise.all([
        fetch(apiUrl(`/api/creator/stores/${encodeURIComponent(slug)}`), { headers: { Authorization: `Bearer ${token}` } }),
        fetch(apiUrl('/api/creator/credits'), { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const sd = (await sRes.json()) as { store?: StoreInfo };
      if (sd.store) setInfo(sd.store);
      const cd = (await cRes.json()) as { balance?: number };
      if (typeof cd.balance === 'number') setCredits(cd.balance);
    } catch {
      setNote('Could not load your store.');
    } finally {
      setLoading(false);
    }
  }, [slug, token]);

  useEffect(() => {
    if (visible) {
      setMode('own');
      setRecords(null);
      setOffer(null);
      setNote(null);
      void load();
    }
  }, [visible, load]);

  // Attach / transfer a domain the creator owns. First call attaches + returns DNS records; calling
  // again (after they set the records) re-verifies and, when verified, flips to live.
  const attach = async () => {
    if (!domain.trim()) return;
    setAttaching(true);
    setNote(null);
    try {
      const res = await fetch(apiUrl(`/api/creator/stores/${encodeURIComponent(slug)}/go-live`), {
        method: 'POST',
        headers,
        body: JSON.stringify({ domain: domain.trim() }),
      });
      const d = (await res.json()) as { live?: boolean; verification?: DnsRecord[]; domain?: string; error?: string };
      if (!res.ok) {
        setNote(d.error ?? 'Could not attach that domain.');
        return;
      }
      if (d.live) {
        setRecords(null);
        await load();
        onLive?.();
        setNote(null);
      } else {
        setRecords(d.verification ?? []);
        setNote('Add these records at your registrar, then tap “I’ve added them”.');
      }
    } catch {
      setNote('Could not reach the domain service.');
    } finally {
      setAttaching(false);
    }
  };

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setOffer(null);
    setNote(null);
    try {
      const res = await fetch(apiUrl(`/api/creator/stores/${encodeURIComponent(slug)}/domain/search?q=${encodeURIComponent(query.trim())}`), { headers });
      const d = (await res.json()) as Offer & { error?: string };
      if (!res.ok) {
        setNote(d.error ?? 'Search failed.');
        return;
      }
      setOffer(d);
    } catch {
      setNote('Could not reach the domain service.');
    } finally {
      setSearching(false);
    }
  };

  const buy = async () => {
    if (!offer?.available || offer.credits == null) return;
    if (credits !== null && credits < offer.credits) {
      setNote(`You need ${offer.credits} credits to buy ${offer.domain} — you have ${credits}.`);
      return;
    }
    setBuying(true);
    setNote(null);
    try {
      const res = await fetch(apiUrl(`/api/creator/stores/${encodeURIComponent(slug)}/domain/buy`), {
        method: 'POST',
        headers,
        body: JSON.stringify({ domain: offer.domain }),
      });
      const d = (await res.json()) as { live?: boolean; note?: string; error?: string; needed?: number; balance?: number };
      if (res.status === 402) {
        setCredits(d.balance ?? credits);
        setNote(`Not enough credits — that domain costs ${d.needed ?? offer.credits}.`);
        return;
      }
      if (!res.ok) throw new Error(d.error ?? 'failed'); // a true failure here means we refunded — not charged
      // 200 = live, 202 = purchased but still registering (charged; finishes attaching shortly).
      setOffer(null);
      setNote(d.note ?? null);
      await load();
      onLive?.();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not buy the domain — your credits were not charged.');
    } finally {
      setBuying(false);
    }
  };

  const isLive = info?.status === 'live' && info.customDomain;
  const previewUrl = info?.deploymentUrl && !info.deploymentUrl.includes('github.com') ? info.deploymentUrl : null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      {/* Nested provider: the app's safe-area context does NOT cross an RN <Modal>, so every
          inset inside resolved to 0 and content tucked under the Dynamic Island (B18 /
          BUG_AUDIT_2026-08-20 #31). Wraps the whole modal body — siblings of the SafeAreaView
          need the context too. */}
      <SafeAreaProvider>
        <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
          <View style={styles.sheet}>
            <View style={styles.headerRow}>
              <ThemedText type="subtitle" style={styles.title} numberOfLines={1}>Go live</ThemedText>
              <View style={{ flex: 1 }} />
              <Pressable onPress={onClose} hitSlop={12}>
                <ThemedText type="code" style={styles.dim}>close ✕</ThemedText>
              </Pressable>
            </View>

            {loading ? (
              <ActivityIndicator style={styles.center} color={pal.accent} />
            ) : (
              <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                {/* Current status */}
                {isLive ? (
                  <View style={styles.liveCard}>
                    <ThemedText type="code" style={styles.sectionLabel}>LIVE</ThemedText>
                    <ThemedText type="subtitle" style={styles.white}>{info!.customDomain}</ThemedText>
                    <ThemedText type="small" style={styles.dim}>Your store is published on its own domain.</ThemedText>
                  </View>
                ) : (
                  <View style={styles.statusCard}>
                    <ThemedText type="code" style={styles.sectionLabel}>NOT LIVE YET</ThemedText>
                    <ThemedText type="small" style={styles.dim}>
                      Your store is on its preview URL{previewUrl ? ` (${previewUrl.replace(/^https?:\/\//, '')})` : ''}. Point it at a domain to launch.
                    </ThemedText>
                  </View>
                )}

                {/* Mode toggle */}
                <View style={styles.toggleRow}>
                  {([['own', 'I own a domain'], ['buy', 'Buy a domain']] as const).map(([m, label]) => (
                    <Pressable key={m} onPress={() => { setMode(m); setNote(null); }} style={[styles.toggle, mode === m && styles.toggleOn]}>
                      <ThemedText type="code" style={mode === m ? styles.chipTextOn : styles.chipText}>{label}</ThemedText>
                    </Pressable>
                  ))}
                </View>

                {mode === 'own' ? (
                  <>
                    <TextInput
                      style={styles.input}
                      placeholder="mybrand.com"
                      placeholderTextColor={pal.dim}
                      autoCapitalize="none"
                      autoCorrect={false}
                      value={domain}
                      onChangeText={(t) => { setDomain(t); setRecords(null); }}
                    />
                    {records?.length ? (
                      <View style={styles.recordsCard}>
                        <ThemedText type="code" style={styles.sectionLabel}>SET THESE AT YOUR REGISTRAR</ThemedText>
                        {records.map((r, i) => (
                          <View key={i} style={styles.recordRow}>
                            <ThemedText type="code" style={styles.recordType}>{r.type}</ThemedText>
                            <View style={{ flex: 1 }}>
                              <ThemedText type="code" style={styles.dim} numberOfLines={1}>{r.domain || '@'}</ThemedText>
                              <ThemedText type="code" style={styles.white} numberOfLines={2}>{r.value}</ThemedText>
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    <Pressable onPress={attach} disabled={attaching || !domain.trim()} style={[styles.primaryBtn, (attaching || !domain.trim()) && { opacity: 0.4 }]}>
                      <ThemedText type="smallBold" style={{ color: pal.onAccent }}>
                        {attaching ? 'Checking…' : records?.length ? 'I’ve added them — re-check' : 'Attach & go live'}
                      </ThemedText>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <View style={styles.searchRow}>
                      <TextInput
                        style={[styles.input, { flex: 1 }]}
                        placeholder="search a domain — mybrand.com"
                        placeholderTextColor={pal.dim}
                        autoCapitalize="none"
                        autoCorrect={false}
                        value={query}
                        onChangeText={(t) => { setQuery(t); setOffer(null); }}
                        onSubmitEditing={search}
                      />
                      <Pressable onPress={search} disabled={searching || !query.trim()} style={[styles.searchBtn, (searching || !query.trim()) && { opacity: 0.4 }]}>
                        <ThemedText type="code" style={{ color: pal.onAccent }}>{searching ? '…' : 'check'}</ThemedText>
                      </Pressable>
                    </View>

                    {offer ? (
                      offer.available && offer.credits != null ? (
                        <View style={styles.offerCard}>
                          <View style={{ flex: 1 }}>
                            <ThemedText type="small" style={styles.white}>{offer.domain}</ThemedText>
                            <ThemedText type="code" style={styles.green}>available · {offer.credits} credits / yr</ThemedText>
                          </View>
                          <Pressable onPress={buy} disabled={buying} style={[styles.primaryBtn, { marginTop: 0 }, buying && { opacity: 0.4 }]}>
                            <ThemedText type="smallBold" style={{ color: pal.onAccent }}>{buying ? 'Buying…' : 'Buy & go live'}</ThemedText>
                          </Pressable>
                        </View>
                      ) : (
                        <ThemedText type="small" style={styles.dim}>{offer.domain} isn’t available — try another name.</ThemedText>
                      )
                    ) : null}
                    {credits !== null ? <ThemedText type="code" style={styles.dim}>balance: {credits} credits</ThemedText> : null}
                  </>
                )}

                {note ? <ThemedText type="small" style={styles.warn}>{note}</ThemedText> : null}
              </ScrollView>
            )}
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

function makeStyles(pal: StudioPalette) {
  return StyleSheet.create({
    fill: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
    sheet: { flex: 1, marginTop: Spacing.six, backgroundColor: pal.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: pal.line, overflow: 'hidden' },
    headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.four, paddingVertical: Spacing.four },
    title: { color: pal.ink, fontFamily: 'Jost-Light' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.six },
    scroll: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
    sectionLabel: { color: pal.accent, letterSpacing: 1.5, fontSize: 11 },
    statusCard: { gap: Spacing.one, padding: Spacing.three, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: pal.line },
    liveCard: { gap: Spacing.one, padding: Spacing.four, borderRadius: 12, borderWidth: 1, borderColor: pal.accent, backgroundColor: pal.card },
    toggleRow: { flexDirection: 'row', gap: Spacing.two },
    toggle: { flex: 1, alignItems: 'center', paddingVertical: Spacing.three, borderRadius: 12, borderWidth: 1, borderColor: pal.line },
    toggleOn: { backgroundColor: pal.accent, borderColor: pal.accent },
    chipText: { color: pal.dim, fontSize: 12 },
    chipTextOn: { color: pal.onAccent, fontSize: 12 },
    input: { borderWidth: 1, borderColor: pal.line, backgroundColor: pal.field, borderRadius: 10, padding: Spacing.three, color: pal.ink, fontSize: 15 },
    searchRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
    searchBtn: { backgroundColor: pal.accent, borderRadius: 10, paddingHorizontal: Spacing.four, paddingVertical: Spacing.three, alignItems: 'center', justifyContent: 'center' },
    offerCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, borderRadius: 12, borderWidth: 1, borderColor: pal.line },
    recordsCard: { gap: Spacing.two, padding: Spacing.three, borderRadius: 12, borderWidth: 1, borderColor: pal.line, backgroundColor: pal.card },
    recordRow: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-start' },
    recordType: { color: pal.accent, fontSize: 12, width: 44 },
    primaryBtn: { backgroundColor: pal.accent, borderRadius: 10, paddingVertical: Spacing.three, paddingHorizontal: Spacing.four, alignItems: 'center', marginTop: Spacing.one },
    white: { color: pal.ink },
    dim: { color: pal.dim },
    green: { color: pal.accent },
    warn: { color: pal.warn },
  });
}
