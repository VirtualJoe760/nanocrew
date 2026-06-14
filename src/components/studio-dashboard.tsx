import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { apiUrl } from '@/lib/api';
import { type StudioPalette, useStudioPalette } from '@/lib/studio-palette';

// The returning creator's Studio landing — no auto-AI. A small Venus presence, and per
// store a thumbnail that's a carousel of product shots (auto-advancing) with the brand's
// OG card (logo + tagline) leading. No website required, so no 404s. Tap → edit mode.
// Theme-aware: matches the Studio screen behind it in light and dark.

type StoreRow = { slug: string; name: string; revenueCents: number; orders: number; ogImageUrl?: string | null; productImages?: string[] };

const THUMB_H = 200;

/** The brand card's thumbnail: a paged, auto-advancing carousel of [OG card, …products].
 *  Falls back to a single image, then to the brand name on the surface colour. */
function BrandThumbnail({ name, ogImageUrl, productImages, p }: { name: string; ogImageUrl?: string | null; productImages?: string[]; p: StudioPalette }) {
  // OG card leads; product shots follow. De-dupe so the OG image isn't repeated.
  const slides = [ogImageUrl, ...(productImages ?? [])].filter((u): u is string => !!u);
  const unique = Array.from(new Set(slides));

  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const scroller = useRef<ScrollView>(null);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width > 0) setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  // Auto-advance through the slides while the card is on screen.
  useEffect(() => {
    if (unique.length < 2 || width === 0) return;
    const id = setInterval(() => {
      setIndex((i) => {
        const next = (i + 1) % unique.length;
        scroller.current?.scrollTo({ x: next * width, animated: true });
        return next;
      });
    }, 3500);
    return () => clearInterval(id);
  }, [unique.length, width]);

  if (!unique.length) {
    return (
      <View style={[{ height: THUMB_H, backgroundColor: p.surface }, styles.thumbFallback]}>
        <ThemedText type="subtitle" style={{ color: p.ink, textAlign: 'center' }} numberOfLines={2}>{name}</ThemedText>
      </View>
    );
  }

  return (
    <View style={{ height: THUMB_H, backgroundColor: p.surface, overflow: 'hidden' }} onLayout={onLayout}>
      {width > 0 ? (
        <ScrollView ref={scroller} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={16}>
          {unique.map((uri) => (
            <Image key={uri} source={{ uri }} style={{ width, height: THUMB_H }} contentFit="cover" />
          ))}
        </ScrollView>
      ) : null}
      {unique.length > 1 ? (
        <View style={styles.dots} pointerEvents="none">
          {unique.map((uri, i) => (
            <View key={uri} style={[styles.dot, i === index && styles.dotOn]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** A small, calm stand-in for the Venus entity — not the full animated orb. */
function VenusGlyph({ accent }: { accent: string }) {
  return (
    <Svg width={40} height={40}>
      <Defs>
        <RadialGradient id="vg" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#f4f4f6" stopOpacity={1} />
          <Stop offset="45%" stopColor={accent} stopOpacity={0.9} />
          <Stop offset="100%" stopColor={accent} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={20} cy={20} r={19} fill="none" stroke={accent} strokeWidth={0.8} opacity={0.4} />
      <Circle cx={20} cy={20} r={9} fill="url(#vg)" />
    </Svg>
  );
}

export function StudioDashboard({
  token,
  onEditBrand,
  onNewBrand,
  onOpenBilling,
}: {
  token: string;
  onEditBrand: (slug: string, name: string) => void;
  onNewBrand: () => void;
  onOpenBilling?: () => void;
}) {
  const p = useStudioPalette();
  const s = useMemo(() => makeStyles(p), [p]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [credits, setCredits] = useState<number | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [statsRes, creditRes, subRes] = await Promise.all([
        fetch(apiUrl('/api/creator/stats'), { headers: { Authorization: `Bearer ${token}` } }),
        fetch(apiUrl('/api/creator/credits'), { headers: { Authorization: `Bearer ${token}` } }),
        fetch(apiUrl('/api/creator/subscription'), { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const d = (await statsRes.json()) as { stores?: StoreRow[] };
      setStores(d.stores ?? []);
      const c = (await creditRes.json()) as { balance?: number };
      if (typeof c.balance === 'number') setCredits(c.balance);
      const sub = (await subRes.json()) as { entitlements?: { plan?: string; active?: boolean } };
      if (sub.entitlements?.active && sub.entitlements.plan) setPlan(sub.entitlements.plan);
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
        <VenusGlyph accent={p.accent} />
        <View style={{ flex: 1 }}>
          <ThemedText type="code" style={s.eyebrow}>VENUS</ThemedText>
          <ThemedText type="small" style={s.dim}>Tap a brand to edit, or start a new one.</ThemedText>
        </View>
        {credits !== null ? (
          <Pressable style={s.creditPill} onPress={onOpenBilling} disabled={!onOpenBilling}>
            {plan ? <ThemedText type="code" style={s.planTag}>{plan.toUpperCase()}</ThemedText> : null}
            <ThemedText type="code" style={s.creditNum}>{credits}</ThemedText>
            <ThemedText type="code" style={s.creditLabel}>credits +</ThemedText>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: Spacing.six }} color={p.accent} />
      ) : (
        <>
          {stores.map((store) => (
            <Pressable key={store.slug} onPress={() => onEditBrand(store.slug, store.name)} style={s.brandCard}>
              <View>
                <BrandThumbnail name={store.name} ogImageUrl={store.ogImageUrl} productImages={store.productImages} p={p} />
                <View style={s.editTag}>
                  <ThemedText type="code" style={s.editTagText}>edit →</ThemedText>
                </View>
              </View>
              <View style={styles.brandMeta}>
                <ThemedText type="subtitle" style={s.ink}>{store.name}</ThemedText>
                <ThemedText type="code" style={s.dim}>
                  ${(store.revenueCents / 100).toFixed(2)} · {store.orders} {store.orders === 1 ? 'order' : 'orders'}
                </ThemedText>
              </View>
            </Pressable>
          ))}

          <Pressable onPress={onNewBrand} style={s.newBrand}>
            <ThemedText type="code" style={s.plus}>+</ThemedText>
            <View>
              <ThemedText type="smallBold" style={s.accent}>Build a new brand</ThemedText>
              <ThemedText type="code" style={s.dim}>Start another store with Venus.</ThemedText>
            </View>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

// Static (theme-independent) layout bits.
const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { paddingBottom: Spacing.six, gap: Spacing.four },
  venusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingTop: Spacing.two },
  thumbFallback: { alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  dots: { position: 'absolute', bottom: Spacing.three, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotOn: { backgroundColor: '#fff', width: 7, height: 7, borderRadius: 4 },
  brandMeta: { padding: Spacing.three, gap: 2 },
});

function makeStyles(p: StudioPalette) {
  return StyleSheet.create({
    eyebrow: { color: p.accent, letterSpacing: 2 },
    dim: { color: p.dim },
    ink: { color: p.ink },
    accent: { color: p.accent },
    creditPill: { alignItems: 'center', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: 14, borderWidth: 1, borderColor: p.line, backgroundColor: p.card },
    planTag: { color: p.accent2, fontSize: 8, letterSpacing: 1.5, marginBottom: 1 },
    creditNum: { color: p.accent, fontSize: 18, fontWeight: '700' },
    creditLabel: { color: p.dim, fontSize: 9, letterSpacing: 1 },
    brandCard: { borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: p.line, backgroundColor: p.card },
    editTag: { position: 'absolute', right: Spacing.three, bottom: Spacing.three, backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 5 },
    editTagText: { color: p.onAccent, fontSize: 11, letterSpacing: 0.5 },
    newBrand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: p.line, padding: Spacing.four },
    plus: { color: p.accent, fontSize: 28, width: 30, textAlign: 'center' },
  });
}
