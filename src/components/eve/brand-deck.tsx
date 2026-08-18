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

// THE BRAND DECK — the brands page, opened only by the wheel's BRANDS spoke. A full-screen deck that
// slides down over Eve, holding your brands as a horizontally-PAGED carousel (one brand per screen,
// swipe left/right), the "+ new brand" page last. It paints its own dark scrim over the persistent
// Eve — no second GL context. Card order (Joe, 2026-08-17): title → console nav → thumbnail →
// FINISH YOUR SITE. Dismiss: the ✕ top-right (swipe-up on the top bar still works).

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
  onBounty,
}: {
  shown: boolean;
  token: string;
  /** Bump to force a refetch (e.g. after a brand is created). */
  refreshKey?: number;
  onClose: () => void;
  onEditBrand: (slug: string, name: string, tab?: 'edit' | 'posts' | 'sell' | 'settings') => void;
  onNewBrand: () => void;
  onBounty?: (panel: 'products' | 'web', slot?: 'hero' | 'cover' | 'logo') => void;
}) {
  const p = useStudioPalette();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const s = makeStyles(p);

  const [stores, setStores] = useState<StoreRow[]>([]);
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    try {
      const statsRes = await fetch(apiUrl('/api/creator/stats'), { headers: { Authorization: `Bearer ${token}` } });
      const d = await readJson<{ stores?: StoreRow[] }>(statsRes);
      setStores(d.stores ?? []);
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
  // Title + nav + checklist all live above the fold now, so the thumbnail gives up height for them.
  const heroH = Math.round(height * 0.32);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, slide]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: BACKDROP }]} pointerEvents="none" />

      {/* Top bar — just the ✕. Swipe-up on the bar still dismisses. */}
      <GestureDetector gesture={dismissPan}>
        <View style={[styles.handleBar, { paddingTop: insets.top + Spacing.two }]}>
          <View style={styles.flex} />
          <Pressable onPress={onClose} hitSlop={14} accessibilityLabel="Close brands">
            <ThemedText type="code" style={s.closeX}>✕</ThemedText>
          </Pressable>
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
              {/* 1 — the brand, named first. */}
              <View style={styles.meta}>
                <ThemedText type="title" style={{ color: p.ink }}>{store.name}</ThemedText>
                <ThemedText type="code" style={s.dim}>
                  ${(store.revenueCents / 100).toFixed(2)} · {store.orders} {store.orders === 1 ? 'order' : 'orders'}
                </ThemedText>
              </View>

              {/* 2 — the console nav (Edit site · Posts · Sell · Settings). */}
              <View style={s.quickRow}>
                {([['edit', 'Edit site'], ['posts', 'Posts'], ['sell', 'Sell'], ['settings', 'Settings']] as const).map(([key, label]) => (
                  <Pressable key={key} style={s.quickPill} onPress={() => onEditBrand(store.slug, store.name, key)} hitSlop={4}>
                    <ThemedText type="code" style={s.quickPillText}>{label}</ThemedText>
                  </Pressable>
                ))}
              </View>

              {/* 3 — the thumbnail (tap opens the console). */}
              <Pressable onPress={() => onEditBrand(store.slug, store.name)} style={s.hero}>
                {hero ? (
                  <Image source={{ uri: hero }} style={{ width: '100%', height: heroH }} contentFit="cover" contentPosition="top" />
                ) : (
                  <View style={[{ width: '100%', height: heroH }, s.heroFallback]}>
                    <ThemedText type="title" style={{ color: p.ink }}>{store.name}</ThemedText>
                  </View>
                )}
              </Pressable>

              {/* 4 — finish-your-site, right under the thumbnail. */}
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
  flex: { flex: 1 },
  handleBar: { flexDirection: 'row', alignItems: 'center', paddingBottom: Spacing.three, paddingHorizontal: Spacing.four },
  pager: { flex: 1 },
  pageCol: { paddingHorizontal: Spacing.four, gap: Spacing.four },
  newCol: { alignItems: 'center', justifyContent: 'center' },
  meta: { gap: Spacing.one },
  dots: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
});

function makeStyles(p: StudioPalette) {
  return StyleSheet.create({
    closeX: { color: p.ink, fontSize: 17, padding: Spacing.one },
    dim: { color: p.dim },
    hero: { borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(205,209,217,0.14)', backgroundColor: 'rgba(24,25,30,0.92)' },
    heroFallback: { alignItems: 'center', justifyContent: 'center' },
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
