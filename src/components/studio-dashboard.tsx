import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { apiUrl, readJson } from '@/lib/api';
import { type StudioPalette, useStudioPalette } from '@/lib/studio-palette';

// The returning creator's Studio landing — no auto-AI. Eve lives in the background now, so
// the dashboard is just a quiet ledger over her: a "YOUR BRANDS" eyebrow, a compact credits
// chip, and per store a thumbnail that's a carousel of product shots (auto-advancing) —
// the OG card only fills in when a brand has no product imagery yet. No website required,
// so no 404s. Tap → edit mode. New brands are built with Eve.

type Bounties = { product: boolean; hero: boolean; logo: boolean; cover: boolean };
type StoreRow = { slug: string; name: string; revenueCents: number; orders: number; ogImageUrl?: string | null; productImages?: string[]; bounties?: Bounties };

const THUMB_H = 220;
// Model shots are PORTRAIT (3:4) — a full-card-wide crop beheads the models. Show them as an
// uncropped 4:5 filmstrip instead; the strip peeks the next tile so it reads as scrollable.
const TILE_W = Math.round(THUMB_H * 0.8);
const TILE_GAP = Spacing.two;

// "Finish your site" setup tasks. Each deep-links into the Design tab on the right panel/slot.
const BOUNTY_STEPS: { key: keyof Bounties; label: string; panel: 'products' | 'web'; slot?: 'hero' | 'cover' | 'logo' }[] = [
  { key: 'product', label: 'Add your first product', panel: 'products' },
  { key: 'hero', label: 'Design your website hero', panel: 'web', slot: 'hero' },
  { key: 'logo', label: 'Add your logo', panel: 'web', slot: 'logo' },
  { key: 'cover', label: 'Add a collection cover', panel: 'web', slot: 'cover' },
];

/** The brand card's thumbnail: an auto-advancing 4:5 filmstrip of product shots (uncropped
 *  portraits — the models keep their faces). Falls back to the OG card full-bleed when there
 *  are no products, then to the brand name. */
function BrandThumbnail({ name, ogImageUrl, productImages, p }: { name: string; ogImageUrl?: string | null; productImages?: string[]; p: StudioPalette }) {
  // Product shots represent the brand; the OG card is only the last resort when a store
  // has no product imagery at all. De-dupe so no shot repeats.
  const products = Array.from(new Set((productImages ?? []).filter((u): u is string => !!u)));

  const [width, setWidth] = useState(0);
  const scroller = useRef<ScrollView>(null);
  const indexRef = useRef(0);
  const dragging = useRef(false);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  // Track the nearest tile so the auto-advance resumes from wherever the user left the strip.
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    indexRef.current = Math.round(e.nativeEvent.contentOffset.x / (TILE_W + TILE_GAP));
  };

  // Auto-advance one tile at a time; loop back to the start past the end. Paused mid-drag.
  useEffect(() => {
    if (products.length < 2 || width === 0) return;
    const maxX = products.length * (TILE_W + TILE_GAP) - width;
    if (maxX <= 0) return; // everything already fits — nothing to advance
    const id = setInterval(() => {
      if (dragging.current) return;
      const next = indexRef.current + 1;
      const x = next * (TILE_W + TILE_GAP);
      if (x > maxX + TILE_W / 2) {
        indexRef.current = 0;
        scroller.current?.scrollTo({ x: 0, animated: true });
      } else {
        indexRef.current = next;
        scroller.current?.scrollTo({ x: Math.min(x, maxX), animated: true });
      }
    }, 3500);
    return () => clearInterval(id);
  }, [products.length, width]);

  if (!products.length) {
    // No product imagery: the OG share card (landscape art — full-bleed is its natural crop).
    if (ogImageUrl) {
      return (
        <View style={{ height: THUMB_H, backgroundColor: p.surface, overflow: 'hidden' }}>
          <Image source={{ uri: ogImageUrl }} style={{ width: '100%', height: THUMB_H }} contentFit="cover" />
        </View>
      );
    }
    return (
      <View style={[{ height: THUMB_H, backgroundColor: p.surface }, styles.thumbFallback]}>
        <ThemedText type="subtitle" style={{ color: p.ink, textAlign: 'center' }} numberOfLines={2}>{name}</ThemedText>
      </View>
    );
  }

  return (
    <View style={{ height: THUMB_H, backgroundColor: p.surface, overflow: 'hidden' }} onLayout={onLayout}>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={TILE_W + TILE_GAP}
        decelerationRate="fast"
        onScroll={onScroll}
        onScrollBeginDrag={() => { dragging.current = true; }}
        onScrollEndDrag={() => { dragging.current = false; }}
        scrollEventThrottle={16}
        contentContainerStyle={{ gap: TILE_GAP }}>
        {products.map((uri) => (
          <Image key={uri} source={{ uri }} style={{ width: TILE_W, height: THUMB_H }} contentFit="cover" contentPosition="top" />
        ))}
      </ScrollView>
    </View>
  );
}

export function StudioDashboard({
  token,
  onEditBrand,
  onNewBrand,
  onOpenBilling,
  onBounty,
}: {
  token: string;
  onEditBrand: (slug: string, name: string) => void;
  onNewBrand: () => void;
  onOpenBilling?: () => void;
  // Tap a setup task → jump into the Design tab on the right panel + slot.
  onBounty?: (panel: 'products' | 'web', slot?: 'hero' | 'cover' | 'logo') => void;
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
      const d = await readJson<{ stores?: StoreRow[] }>(statsRes);
      setStores(d.stores ?? []);
      const c = await readJson<{ balance?: number }>(creditRes);
      if (typeof c.balance === 'number') setCredits(c.balance);
      const sub = await readJson<{ entitlements?: { plan?: string; active?: boolean } }>(subRes);
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
      {/* Header: section eyebrow left, a slim credits chip right (tap → billing). */}
      <View style={styles.headerRow}>
        <ThemedText type="code" style={s.sectionLabel}>YOUR BRANDS</ThemedText>
        {credits !== null ? (
          <Pressable style={s.creditChip} onPress={onOpenBilling} disabled={!onOpenBilling}>
            {plan ? <ThemedText type="code" style={s.chipPlan}>{plan.toUpperCase()} · </ThemedText> : null}
            <ThemedText type="code" style={s.chipCredits}>✦ {credits.toLocaleString()}</ThemedText>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: Spacing.six }} color={p.accent} />
      ) : (
        <>
          {stores.map((store) => {
            const todo = store.bounties ? BOUNTY_STEPS.filter((b) => !store.bounties![b.key]) : [];
            return (
              <View key={store.slug} style={styles.brandGroup}>
                <Pressable onPress={() => onEditBrand(store.slug, store.name)} style={s.brandCard}>
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

                {todo.length && onBounty ? (
                  <View style={s.bountyBox}>
                    <ThemedText type="code" style={s.eyebrow}>FINISH YOUR SITE</ThemedText>
                    {todo.map((b) => (
                      <Pressable key={b.key} style={s.bountyRow} onPress={() => onBounty(b.panel, b.slot)}>
                        <ThemedText type="small" style={s.ink}>○  {b.label}</ThemedText>
                        <ThemedText type="small" style={s.accent}>→</ThemedText>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}

          <Pressable onPress={onNewBrand} style={s.newBrand}>
            <ThemedText type="code" style={s.plus}>+</ThemedText>
            <View>
              <ThemedText type="smallBold" style={s.accent}>Build a new brand</ThemedText>
              <ThemedText type="code" style={s.dim}>Start another brand with Eve.</ThemedText>
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
  scroll: { paddingBottom: BottomTabInset + Spacing.six, gap: Spacing.four },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three, paddingTop: Spacing.two },
  thumbFallback: { alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  brandMeta: { padding: Spacing.three, gap: 2 },
  brandGroup: { gap: Spacing.two },
});

function makeStyles(p: StudioPalette) {
  return StyleSheet.create({
    eyebrow: { color: p.accent, letterSpacing: 2 },
    dim: { color: p.dim },
    ink: { color: p.ink },
    accent: { color: p.accent },
    sectionLabel: { color: p.dim, letterSpacing: 2 },
    // Slim credits chip — mostly-opaque so it reads over the Eve scrim without shouting.
    creditChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: p.line, backgroundColor: 'rgba(22,22,25,0.7)' },
    chipPlan: { color: p.dim, fontSize: 11, letterSpacing: 1 },
    chipCredits: { color: p.ink, fontSize: 11, letterSpacing: 0.5 },
    // A touch more lift than p.card so the cards stay alive over Eve's animated net.
    brandCard: { borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(205,209,217,0.14)', backgroundColor: 'rgba(24,25,30,0.92)' },
    editTag: { position: 'absolute', right: Spacing.three, bottom: Spacing.three, backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 5 },
    editTagText: { color: p.onAccent, fontSize: 11, letterSpacing: 0.5 },
    newBrand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: p.line, padding: Spacing.four },
    plus: { color: p.accent, fontSize: 28, width: 30, textAlign: 'center' },
    bountyBox: { borderRadius: 14, borderWidth: 1, borderColor: p.line, backgroundColor: p.card, padding: Spacing.three, gap: Spacing.two },
    bountyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.one },
  });
}
