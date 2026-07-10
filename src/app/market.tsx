import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
  useWindowDimensions,
  type ViewToken,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { openBrowserAsync } from 'expo-web-browser';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandStore } from '@/components/brand-store';
import { getBlockedBrands } from '@/lib/blocklist';
import { Spacing } from '@/constants/theme';
import { withScreenFade } from '@/components/screen-fade';
import { useAuth } from '@/hooks/use-auth';
import { apiFetch, apiUrl } from '@/lib/api';

// THE MARKET — an immersive, Instagram/TikTok-Shop-style vertical feed: one product per screen,
// full-bleed. Autoplays the product's Veo video where one exists, an on-model shot otherwise; brand,
// price and Shop float over the media, with like / share / try-on down the side. Tapping through
// opens the brand's in-app store sheet. Opaque + full-bleed, so the persistent Eve stays hidden
// (and frozen) behind it — no GPU cost on this tab.

type FeedItem = {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  videoUrl: string | null;
  descriptionMd: string | null;
  storeName: string;
  storeSlug: string;
  siteUrl: string | null;
  priceCents: number | null;
  likeCount: number;
  shareCount: number;
  likedByMe: boolean;
};

/** The product's page on the brand's real storefront, or null when there's no live website yet. */
function productUrl(item: FeedItem): string | null {
  return item.siteUrl ? `${item.siteUrl}/product/${item.slug}` : null;
}

function fmtCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`;
}

// Only the active card's video is mounted (see FeedCard), so a player exists for one item at a time.
function VideoCard({ url, active }: { url: string; active: boolean }) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.muted = true;
  });
  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />;
}

function FeedCard({
  item,
  height,
  active,
  onTryOn,
  onLike,
  onShare,
  onTitle,
  onShop,
}: {
  item: FeedItem;
  height: number;
  active: boolean;
  onTryOn: (item: FeedItem) => void;
  onLike: (item: FeedItem) => void;
  onShare: (item: FeedItem) => void;
  onTitle: (item: FeedItem) => void;
  onShop: (item: FeedItem) => void;
}) {
  return (
    <Pressable style={[styles.card, { height }]} onPress={() => onShop(item)}>
      {item.videoUrl && active ? (
        <VideoCard url={item.videoUrl} active={active} />
      ) : item.imageUrl ? (
        <Image source={{ uri: item.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallback]} />
      )}

      {/* Bottom scrim + product info */}
      <View style={styles.scrim} pointerEvents="none" />
      <View style={styles.info}>
        <ThemedText type="smallBold" style={styles.handle}>@{item.storeSlug}</ThemedText>
        <Pressable onPress={() => onTitle(item)} hitSlop={6}>
          <ThemedText type="subtitle" style={styles.title} numberOfLines={2}>{item.name}</ThemedText>
        </Pressable>
        <View style={styles.metaRow}>
          <ThemedText type="small" style={styles.sub} numberOfLines={1}>
            {item.storeName}
            {item.priceCents != null ? ` · $${(item.priceCents / 100).toFixed(2)}` : ''}
          </ThemedText>
          <Pressable onPress={() => onShop(item)} hitSlop={6} style={styles.buyTag}>
            <ThemedText type="smallBold" style={styles.buyTagText}>Shop</ThemedText>
          </Pressable>
        </View>
      </View>

      {/* Right-side actions */}
      <View style={styles.actions}>
        <Pressable onPress={() => onLike(item)} style={styles.actionBtn} hitSlop={6}>
          <ThemedText style={[styles.actionGlyph, item.likedByMe && styles.liked]}>{item.likedByMe ? '♥' : '♡'}</ThemedText>
          <ThemedText type="small" style={styles.actionLabel}>{item.likeCount > 0 ? fmtCount(item.likeCount) : 'Like'}</ThemedText>
        </Pressable>
        <Pressable onPress={() => onShare(item)} style={styles.actionBtn} hitSlop={6}>
          <ThemedText style={styles.actionGlyph}>↗</ThemedText>
          <ThemedText type="small" style={styles.actionLabel}>{item.shareCount > 0 ? fmtCount(item.shareCount) : 'Share'}</ThemedText>
        </Pressable>
        <Pressable onPress={() => onTryOn(item)} style={styles.actionBtn} hitSlop={6}>
          <ThemedText style={styles.actionGlyph}>🤳</ThemedText>
          <ThemedText type="small" style={styles.actionLabel}>Try on</ThemedText>
        </Pressable>
      </View>
    </Pressable>
  );
}

export default withScreenFade(MarketScreen);

function MarketScreen() {
  const { session } = useAuth();
  const { height: winH } = useWindowDimensions();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  // The exact content height comes from onLayout; fall back to the window height so the feed always
  // renders immediately (onLayout can be slow — or, on web, not fire at all — leaving it at 0).
  const [measured, setMeasured] = useState(0);
  const [tryOn, setTryOn] = useState<{ item: FeedItem; busy: boolean; result?: string; error?: string } | null>(null);
  const [detail, setDetail] = useState<FeedItem | null>(null);
  const [storeSlug, setStoreSlug] = useState<string | null>(null);

  // Blocked brands (Apple Guideline 1.2) — reloaded when the brand sheet closes so a block takes
  // effect immediately on return to the feed.
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const refreshBlocked = useCallback(() => { void getBlockedBrands().then((s) => setBlocked(new Set(s))); }, []);
  useEffect(() => { refreshBlocked(); }, [refreshBlocked]);

  // Shop / tap-through → open the brand's in-app store sheet.
  const onShop = useCallback((item: FeedItem) => { setDetail(null); setStoreSlug(item.storeSlug); }, []);

  useEffect(() => {
    fetch(apiUrl('/api/feed'), session ? { headers: { Authorization: `Bearer ${session.access_token}` } } : undefined)
      .then((r) => r.json())
      .then((d: { items?: FeedItem[] }) => setItems(d.items ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [session]);

  // Deep-link from the feed's Buy tag elsewhere: /market?store=<slug> opens that brand's store.
  const { store } = useLocalSearchParams<{ store?: string }>();
  useEffect(() => { if (store) setStoreSlug(store); }, [store]);

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable);
    if (first?.index != null) setActiveIndex(first.index);
  }).current;

  const onLike = useCallback(async (item: FeedItem) => {
    if (!session) return;
    const liked = !item.likedByMe;
    setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, likedByMe: liked, likeCount: p.likeCount + (liked ? 1 : -1) } : p)));
    try {
      const r = await fetch(apiUrl(`/api/feed/${item.id}/like`), { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } });
      const d = (await r.json()) as { liked?: boolean; likeCount?: number };
      if (typeof d.likeCount === 'number') {
        setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, likedByMe: !!d.liked, likeCount: d.likeCount! } : p)));
      }
    } catch {
      /* leave optimistic state */
    }
  }, [session]);

  const onShare = useCallback(async (item: FeedItem) => {
    const url = productUrl(item);
    try {
      const res = await Share.share(url ? { message: `${item.name} by ${item.storeName} — ${url}`, url } : { message: `${item.name} by ${item.storeName}` });
      if (res.action === Share.sharedAction) {
        setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, shareCount: p.shareCount + 1 } : p)));
        fetch(apiUrl(`/api/feed/${item.id}/share`), { method: 'POST' }).catch(() => {});
      }
    } catch {
      /* share cancelled */
    }
  }, []);

  const startTryOn = useCallback(async (item: FeedItem) => {
    if (!session) { setTryOn({ item, busy: false, error: 'Sign in to try things on.' }); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.85 });
    const a = res.assets?.[0];
    if (res.canceled || !a?.base64) return;
    const selfie = `data:${a.mimeType ?? 'image/jpeg'};base64,${a.base64}`;
    setTryOn({ item, busy: true });
    try {
      const r = await apiFetch('/api/tryon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selfie, productId: item.id }) });
      const d = (await r.json()) as { image?: string; error?: string };
      if (!d.image) throw new Error(d.error || 'Try-on failed');
      setTryOn({ item, busy: false, result: d.image });
    } catch (e) {
      setTryOn({ item, busy: false, error: e instanceof Error ? e.message : 'Try-on failed' });
    }
  }, [session]);

  const feed = items.filter((i) => !blocked.has(i.storeSlug));
  const pageHeight = measured || winH;

  return (
    <ThemedView style={styles.container}>
      <View style={styles.fill} onLayout={(e) => setMeasured(e.nativeEvent.layout.height)}>
        {loading ? (
          <ActivityIndicator style={styles.center} />
        ) : !feed.length ? (
          <View style={styles.center}>
            <ThemedText themeColor="textSecondary">No drops yet.</ThemedText>
          </View>
        ) : (
          <FlatList
            data={feed}
            keyExtractor={(i) => i.id}
            renderItem={({ item, index }) => (
              <FeedCard
                item={item}
                height={pageHeight}
                active={index === activeIndex}
                onTryOn={startTryOn}
                onLike={onLike}
                onShare={onShare}
                onTitle={setDetail}
                onShop={onShop}
              />
            )}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            snapToInterval={pageHeight}
            decelerationRate="fast"
            onViewableItemsChanged={onViewable}
            viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
            getItemLayout={(_d, index) => ({ length: pageHeight, offset: pageHeight * index, index })}
          />
        )}
      </View>

      {/* Product quick-look — title tap. */}
      {detail ? (
        <Modal visible transparent animationType="slide" onRequestClose={() => setDetail(null)}>
          <View style={styles.detailBackdrop}>
            <ThemedView type="background" style={styles.detailCard}>
              <View style={styles.detailHeader}>
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold" themeColor="textSecondary">@{detail.storeSlug}</ThemedText>
                  <ThemedText type="subtitle">{detail.name}</ThemedText>
                </View>
                <Pressable onPress={() => setDetail(null)} hitSlop={10}>
                  <ThemedText type="small" themeColor="textSecondary">Close</ThemedText>
                </Pressable>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {detail.storeName}
                {detail.priceCents != null ? ` · $${(detail.priceCents / 100).toFixed(2)}` : ''}
              </ThemedText>
              {detail.descriptionMd ? (
                <ScrollView style={styles.detailBody}>
                  <ThemedText type="small">{detail.descriptionMd}</ThemedText>
                </ScrollView>
              ) : (
                <ThemedText type="small" themeColor="textSecondary">No description yet.</ThemedText>
              )}
              <View style={styles.detailActions}>
                <Pressable onPress={() => onShop(detail)} style={styles.detailPrimary}>
                  <ThemedText type="smallBold" style={{ color: '#08080a' }}>Shop @{detail.storeSlug}</ThemedText>
                </Pressable>
                {productUrl(detail) ? (
                  <Pressable onPress={() => openBrowserAsync(productUrl(detail)!)} hitSlop={8}>
                    <ThemedText type="small" themeColor="tint">View product ↗</ThemedText>
                  </Pressable>
                ) : null}
              </View>
            </ThemedView>
          </View>
        </Modal>
      ) : null}

      {/* Try-on result */}
      {tryOn ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setTryOn(null)}>
          <View style={styles.tryOnBackdrop}>
            <ThemedView type="background" style={styles.tryOnCard}>
              <View style={styles.tryOnHeader}>
                <ThemedText type="smallBold">Try on · {tryOn.item.name}</ThemedText>
                <Pressable onPress={() => setTryOn(null)} hitSlop={10}>
                  <ThemedText type="small" themeColor="textSecondary">Close</ThemedText>
                </Pressable>
              </View>
              {tryOn.busy ? (
                <View style={styles.tryOnBody}>
                  <ActivityIndicator />
                  <ThemedText type="small" themeColor="textSecondary">Fitting it on you…</ThemedText>
                </View>
              ) : tryOn.result ? (
                <Image source={{ uri: tryOn.result }} style={styles.tryOnImg} contentFit="cover" />
              ) : (
                <ThemedText type="small" style={{ color: '#e24b4a' }}>{tryOn.error}</ThemedText>
              )}
            </ThemedView>
          </View>
        </Modal>
      ) : null}

      <BrandStore slug={storeSlug} visible={!!storeSlug} onClose={() => { setStoreSlug(null); refreshBlocked(); }} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { width: '100%', overflow: 'hidden', backgroundColor: '#000' },
  fallback: { backgroundColor: '#1a1a1a' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 300, backgroundColor: 'rgba(0,0,0,0.5)' },
  info: { position: 'absolute', left: Spacing.four, right: 90, bottom: 40, gap: Spacing.one },
  // Text sits over arbitrary product media (light or dark), so every overlay label carries a soft shadow.
  handle: { color: '#fff', opacity: 0.92, textShadowColor: 'rgba(0,0,0,0.7)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  title: { color: '#fff', textShadowColor: 'rgba(0,0,0,0.75)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, marginTop: Spacing.one },
  sub: { color: '#fff', opacity: 0.92, flexShrink: 1, textShadowColor: 'rgba(0,0,0,0.7)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  buyTag: { backgroundColor: '#f4f4f6', borderRadius: 999, paddingHorizontal: Spacing.four, paddingVertical: 5, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  buyTagText: { color: '#08080a' },
  actions: { position: 'absolute', right: Spacing.four, bottom: 70, alignItems: 'center', gap: Spacing.four },
  actionBtn: { alignItems: 'center', gap: 3, paddingVertical: Spacing.one, width: 52 },
  actionGlyph: { fontSize: 28, lineHeight: 36, color: '#fff', textAlign: 'center', includeFontPadding: false, textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 },
  liked: { color: '#e8eaee' },
  actionLabel: { color: '#fff', opacity: 0.95, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  tryOnBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  detailBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  detailCard: { borderTopLeftRadius: Spacing.five, borderTopRightRadius: Spacing.five, padding: Spacing.four, gap: Spacing.three, maxHeight: '70%' },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  detailBody: { maxHeight: 200 },
  detailActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four, marginTop: Spacing.one },
  detailPrimary: { backgroundColor: '#cdd1d9', borderRadius: 10, paddingVertical: Spacing.three, paddingHorizontal: Spacing.five, alignItems: 'center' },
  tryOnCard: { width: '100%', maxWidth: 420, borderRadius: Spacing.four, padding: Spacing.four, gap: Spacing.three },
  tryOnHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tryOnBody: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.six },
  tryOnImg: { width: '100%', aspectRatio: 1, borderRadius: Spacing.three },
});
