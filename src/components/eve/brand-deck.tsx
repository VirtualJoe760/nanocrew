import { useCallback, useEffect, useState } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { glow } from '@/constants/glow';
import { apiUrl, readJson } from '@/lib/api';
import { type StudioPalette, useStudioPalette } from '@/lib/studio-palette';

// THE BRAND DECK — the Eve tab's "swipe down from the top for the UI" surface (the reverse of the old
// pull-down: Eve is the default now, and you pull the brand UI DOWN over her). A full-screen deck that
// slides down, holding your brands as a horizontally-PAGED carousel (one brand per screen, swipe
// left/right), the "+ new brand" page last. It paints its own dark scrim over the persistent Eve — no
// second GL context. Dismiss: swipe UP on the top handle, or tap it.

const OPEN_MS = 320;
const BACKDROP = 'rgba(6,8,12,0.9)'; // near-opaque so brand imagery reads; Eve still glows faintly through

type Bounties = { product: boolean; hero: boolean; logo: boolean; cover: boolean };
type StoreRow = { slug: string; name: string; revenueCents: number; orders: number; ogImageUrl?: string | null; productImages?: string[]; bounties?: Bounties };

const BOUNTY_STEPS: { key: keyof Bounties; label: string; panel: 'products' | 'web'; slot?: 'hero' | 'cover' | 'logo' }[] = [
  { key: 'product', label: 'Add your first product', panel: 'products' },
  { key: 'hero', label: 'Design your website hero', panel: 'web', slot: 'hero' },
  { key: 'logo', label: 'Add your logo', panel: 'web', slot: 'logo' },
  { key: 'cover', label: 'Add a collection cover', panel: 'web', slot: 'cover' },
];

export function BrandDeck({
  shown,
  token,
  refreshKey,
  onClose,
  onEditBrand,
  onNewBrand,
  onOpenBilling,
  onBounty,
}: {
  shown: boolean;
  token: string;
  /** Bump to force a refetch (e.g. after a brand is created). */
  refreshKey?: number;
  onClose: () => void;
  onEditBrand: (slug: string, name: string, tab?: 'edit' | 'posts' | 'sell' | 'settings') => void;
  onNewBrand: () => void;
  onOpenBilling?: () => void;
  onBounty?: (panel: 'products' | 'web', slot?: 'hero' | 'cover' | 'logo') => void;
}) {
  const p = useStudioPalette();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const s = makeStyles(p);

  const [stores, setStores] = useState<StoreRow[]>([]);
  const [credits, setCredits] = useState<number | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    try {
      const [statsRes, creditRes, subRes] = await Promise.all([
        fetch(apiUrl('/api/creator/stats'), { headers: { Authorization: `Bearer ${token}` } }),
        fetch(apiUrl('/api/creator/credits'), { headers: { Authorization: `Bearer ${token}` } }),
        fetch(apiUrl('/api/creator/subscription'), { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const d = await readJson<{ stores?: StoreRow[] }>(statsRes);
      setStores(d.stores ?? []);
      const c = await readJson<{ balance?: number }>(creditRes);
      if (typeof c.balance === 'number') setCredits(c.balance);
      const sub = await readJson<{ entitlements?: { plan?: string; active?: boolean } }>(subRes);
      if (sub.entitlements?.active && sub.entitlements.plan) setPlan(sub.entitlements.plan);
    } catch {
      /* keep prior */
    }
  }, [token]);

  // Refetch on mount + whenever the deck is pulled open (so it's always fresh) + on refreshKey bumps.
  useEffect(() => {
    if (shown) void load();
  }, [shown, refreshKey, load]);

  // ── Slide: parked above the top edge (-height), drops to 0 when shown. ──
  const ty = useSharedValue(-height);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (shown) {
      setMounted(true);
      ty.value = withTiming(0, { duration: OPEN_MS, easing: Easing.out(Easing.cubic) });
    } else {
      ty.value = withTiming(-height, { duration: OPEN_MS, easing: Easing.in(Easing.cubic) }, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
    }
  }, [shown, height, ty]);

  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));

  // Swipe UP on the top handle dismisses (scoped to the handle so the horizontal pager keeps its
  // gestures). Distance OR velocity commits — mirrors the old overlay's dismiss thresholds.
  const dismissPan = Gesture.Pan()
    .activeOffsetY(-14)
    .onEnd((e) => {
      if (e.translationY < -40 || e.velocityY < -500) runOnJS(onClose)();
    });

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width > 0) setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  if (!mounted) return null;

  const pageCount = stores.length + 1; // brands + the "new brand" page
  const heroH = Math.round(height * 0.46);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, slide]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: BACKDROP }]} pointerEvents="none" />

      {/* Top handle — grabber + label + credits chip; swipe up or tap to close. */}
      <GestureDetector gesture={dismissPan}>
        <View style={[styles.handleBar, { paddingTop: insets.top + Spacing.two }]}>
          <Pressable onPress={onClose} hitSlop={16} style={styles.grabberHit} accessibilityLabel="Close brands">
            <View style={s.grabber} />
          </Pressable>
          <View style={styles.handleRow}>
            <ThemedText type="code" style={s.sectionLabel}>YOUR BRANDS</ThemedText>
            {credits !== null ? (
              <Pressable style={s.creditChip} onPress={onOpenBilling} disabled={!onOpenBilling}>
                {plan ? <ThemedText type="code" style={s.chipPlan}>{plan.toUpperCase()} · </ThemedText> : null}
                <ThemedText type="code" style={s.chipCredits}>✦ {credits.toLocaleString()}</ThemedText>
              </Pressable>
            ) : null}
          </View>
        </View>
      </GestureDetector>

      {/* Horizontally-paged brands — one per screen; the last page builds a new brand. */}
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={styles.pager}>
        {stores.map((store) => {
          const hero = store.productImages?.[0] ?? store.ogImageUrl ?? null;
          const todo = store.bounties ? BOUNTY_STEPS.filter((b) => !store.bounties![b.key]) : [];
          return (
            <View key={store.slug} style={[styles.pageCol, { width }]}>
              <Pressable onPress={() => onEditBrand(store.slug, store.name)} style={s.hero}>
                {hero ? (
                  <Image source={{ uri: hero }} style={{ width: '100%', height: heroH }} contentFit="cover" contentPosition="top" />
                ) : (
                  <View style={[{ width: '100%', height: heroH }, s.heroFallback]}>
                    <ThemedText type="title" style={{ color: p.ink }}>{store.name}</ThemedText>
                  </View>
                )}
                <View style={s.editTag}>
                  <ThemedText type="code" style={s.editTagText}>edit →</ThemedText>
                </View>
              </Pressable>

              <View style={styles.meta}>
                <ThemedText type="title" style={{ color: p.ink }}>{store.name}</ThemedText>
                <ThemedText type="code" style={s.dim}>
                  ${(store.revenueCents / 100).toFixed(2)} · {store.orders} {store.orders === 1 ? 'order' : 'orders'}
                </ThemedText>
              </View>

              {/* Everything the console offers, one tap from the card — posts were invisible from
                  here (the console has a full Posts tab nothing pointed at). */}
              <View style={s.quickRow}>
                {([['edit', 'Edit site'], ['posts', 'Posts'], ['sell', 'Sell'], ['settings', 'Settings']] as const).map(([key, label]) => (
                  <Pressable key={key} style={s.quickPill} onPress={() => onEditBrand(store.slug, store.name, key)} hitSlop={4}>
                    <ThemedText type="code" style={s.quickPillText}>{label}</ThemedText>
                  </Pressable>
                ))}
              </View>

              {todo.length && onBounty ? (
                <View style={s.bountyBox}>
                  <ThemedText type="code" style={s.bountyHead}>FINISH YOUR SITE</ThemedText>
                  {todo.map((b) => (
                    <Pressable key={b.key} style={s.bountyRow} onPress={() => onBounty(b.panel, b.slot)}>
                      <ThemedText type="small" style={{ color: p.ink }}>○  {b.label}</ThemedText>
                      <ThemedText type="small" style={{ color: p.accent }}>→</ThemedText>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}

        {/* New-brand page. */}
        <View style={[styles.pageCol, styles.newCol, { width }]}>
          <Pressable onPress={onNewBrand} style={({ pressed }) => [s.newBrand, glow(p.accent, 16, pressed ? 0.3 : 0.5)]}>
            <ThemedText type="code" style={[s.plus, { color: p.accent }]}>+</ThemedText>
            <ThemedText type="smallBold" style={{ color: p.accent }}>Build a new brand</ThemedText>
            <ThemedText type="code" style={s.dim}>Start another brand with Eve.</ThemedText>
          </Pressable>
        </View>
      </ScrollView>

      {/* Paging dots. */}
      {pageCount > 1 ? (
        <View style={[styles.dots, { bottom: insets.bottom + Spacing.four }]} pointerEvents="none">
          {Array.from({ length: pageCount }).map((_, i) => (
            <View key={i} style={[s.dot, i === page && s.dotOn]} />
          ))}
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { zIndex: 50 },
  handleBar: { paddingBottom: Spacing.three, paddingHorizontal: Spacing.four, gap: Spacing.three },
  grabberHit: { alignSelf: 'center', paddingVertical: Spacing.two, paddingHorizontal: Spacing.six },
  handleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pager: { flex: 1 },
  pageCol: { paddingHorizontal: Spacing.four, gap: Spacing.four },
  newCol: { alignItems: 'center', justifyContent: 'center' },
  meta: { gap: Spacing.one },
  dots: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
});

function makeStyles(p: StudioPalette) {
  return StyleSheet.create({
    grabber: { width: 44, height: 4, borderRadius: 2, backgroundColor: 'rgba(207,232,243,0.4)' },
    sectionLabel: { color: p.dim, letterSpacing: 2 },
    dim: { color: p.dim },
    creditChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: p.line, backgroundColor: 'rgba(22,22,25,0.7)' },
    chipPlan: { color: p.dim, fontSize: 11, letterSpacing: 1 },
    chipCredits: { color: p.ink, fontSize: 11, letterSpacing: 0.5 },
    hero: { borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(205,209,217,0.14)', backgroundColor: 'rgba(24,25,30,0.92)' },
    heroFallback: { alignItems: 'center', justifyContent: 'center' },
    editTag: { position: 'absolute', right: Spacing.three, bottom: Spacing.three, backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 5 },
    editTagText: { color: p.onAccent, fontSize: 11, letterSpacing: 0.5 },
    quickRow: { flexDirection: 'row', gap: Spacing.two },
    quickPill: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: 999, borderWidth: 1, borderColor: p.line, backgroundColor: 'rgba(22,22,25,0.7)' },
    quickPillText: { color: p.ink, fontSize: 11, letterSpacing: 0.5 },
    bountyBox: { borderRadius: 14, borderWidth: 1, borderColor: p.line, backgroundColor: 'rgba(22,22,25,0.6)', padding: Spacing.four, gap: Spacing.three },
    bountyHead: { color: p.accent, letterSpacing: 1.5 },
    bountyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    newBrand: { alignItems: 'center', gap: Spacing.two, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: p.line, paddingVertical: Spacing.six, paddingHorizontal: Spacing.six, backgroundColor: 'rgba(22,22,25,0.5)' },
    plus: { fontSize: 32 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(205,209,217,0.3)' },
    dotOn: { backgroundColor: p.accent, width: 7, height: 7, borderRadius: 4 },
  });
}
