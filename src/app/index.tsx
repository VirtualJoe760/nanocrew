import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  View,
  type ViewToken,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { apiUrl } from '@/lib/api';

// The Nanocrew tab: a TikTok-style full-screen vertical feed of published products
// across all stores — Veo product videos where available, mockups otherwise.

type FeedItem = {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  videoUrl: string | null;
  descriptionMd: string | null;
  storeName: string;
  storeSlug: string;
  priceCents: number | null;
  likeCount: number;
  shareCount: number;
  likedByMe: boolean;
};

function siteUrlFor(slug: string): string {
  return `https://store-${slug}.vercel.app`;
}

function fmtCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`;
}

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
}: {
  item: FeedItem;
  height: number;
  active: boolean;
  onTryOn: (item: FeedItem) => void;
  onLike: (item: FeedItem) => void;
  onShare: (item: FeedItem) => void;
}) {
  return (
    <View style={[styles.card, { height }]}>
      {item.videoUrl && active ? (
        <VideoCard url={item.videoUrl} active={active} />
      ) : item.imageUrl ? (
        <Image source={{ uri: item.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallback]} />
      )}

      {/* Bottom scrim + product info */}
      <View style={styles.scrim} pointerEvents="none" />
      <View style={styles.info}>
        <ThemedText type="smallBold" style={styles.handle}>
          @{item.storeSlug}
        </ThemedText>
        <ThemedText type="title" style={styles.title} numberOfLines={2}>
          {item.name}
        </ThemedText>
        <ThemedText type="small" style={styles.sub} numberOfLines={2}>
          {item.storeName}
          {item.priceCents != null ? ` · $${(item.priceCents / 100).toFixed(2)}` : ''}
        </ThemedText>
      </View>

      {/* Right-side actions */}
      <View style={styles.actions}>
        <Pressable onPress={() => onLike(item)} style={styles.actionBtn} hitSlop={6}>
          <ThemedText style={[styles.actionGlyph, item.likedByMe && styles.liked]}>
            {item.likedByMe ? '♥' : '♡'}
          </ThemedText>
          <ThemedText type="small" style={styles.actionLabel}>
            {item.likeCount > 0 ? fmtCount(item.likeCount) : 'Like'}
          </ThemedText>
        </Pressable>
        <Pressable onPress={() => onShare(item)} style={styles.actionBtn} hitSlop={6}>
          <ThemedText style={styles.actionGlyph}>↗</ThemedText>
          <ThemedText type="small" style={styles.actionLabel}>
            {item.shareCount > 0 ? fmtCount(item.shareCount) : 'Share'}
          </ThemedText>
        </Pressable>
        <Pressable onPress={() => onTryOn(item)} style={styles.actionBtn} hitSlop={6}>
          <ThemedText style={styles.actionGlyph}>🤳</ThemedText>
          <ThemedText type="small" style={styles.actionLabel}>
            Try on
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

export default function FeedScreen() {
  const { session } = useAuth();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pageHeight, setPageHeight] = useState(0);
  const [tryOn, setTryOn] = useState<{ item: FeedItem; busy: boolean; result?: string; error?: string } | null>(null);

  useEffect(() => {
    fetch(apiUrl('/api/feed'), session ? { headers: { Authorization: `Bearer ${session.access_token}` } } : undefined)
      .then((r) => r.json())
      .then((d: { items?: FeedItem[] }) => setItems(d.items ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [session]);

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable);
    if (first?.index != null) setActiveIndex(first.index);
  }).current;

  // Optimistic like toggle — a free account is enough; signed-out taps no-op gracefully.
  const onLike = useCallback(
    async (item: FeedItem) => {
      if (!session) return;
      const liked = !item.likedByMe;
      setItems((prev) =>
        prev.map((p) => (p.id === item.id ? { ...p, likedByMe: liked, likeCount: p.likeCount + (liked ? 1 : -1) } : p)),
      );
      try {
        const r = await fetch(apiUrl(`/api/feed/${item.id}/like`), {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const d = (await r.json()) as { liked?: boolean; likeCount?: number };
        if (typeof d.likeCount === 'number') {
          setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, likedByMe: !!d.liked, likeCount: d.likeCount! } : p)));
        }
      } catch {
        /* leave optimistic state */
      }
    },
    [session],
  );

  const onShare = useCallback(async (item: FeedItem) => {
    const url = `${siteUrlFor(item.storeSlug)}/product/${item.slug}`;
    try {
      const res = await Share.share({ message: `${item.name} by ${item.storeName} — ${url}`, url });
      if (res.action === Share.sharedAction) {
        setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, shareCount: p.shareCount + 1 } : p)));
        fetch(apiUrl(`/api/feed/${item.id}/share`), { method: 'POST' }).catch(() => {});
      }
    } catch {
      /* share cancelled */
    }
  }, []);

  const startTryOn = useCallback(async (item: FeedItem) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.85 });
    const a = res.assets?.[0];
    if (res.canceled || !a?.base64) return;
    const selfie = `data:${a.mimeType ?? 'image/jpeg'};base64,${a.base64}`;
    setTryOn({ item, busy: true });
    try {
      const r = await fetch(apiUrl('/api/tryon'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selfie, productId: item.id }),
      });
      const d = (await r.json()) as { image?: string; error?: string };
      if (!d.image) throw new Error(d.error || 'Try-on failed');
      setTryOn({ item, busy: false, result: d.image });
    } catch (e) {
      setTryOn({ item, busy: false, error: e instanceof Error ? e.message : 'Try-on failed' });
    }
  }, []);

  return (
    <ThemedView style={styles.container}>
      <View style={styles.fill} onLayout={(e) => setPageHeight(e.nativeEvent.layout.height)}>
        {loading ? (
          <ActivityIndicator style={styles.center} />
        ) : !items.length ? (
          <View style={styles.center}>
            <ThemedText themeColor="textSecondary">No drops yet — publish one in Design.</ThemedText>
          </View>
        ) : pageHeight > 0 ? (
          <FlatList
            data={items}
            keyExtractor={(i) => i.id}
            renderItem={({ item, index }) => (
              <FeedCard
                item={item}
                height={pageHeight}
                active={index === activeIndex}
                onTryOn={startTryOn}
                onLike={onLike}
                onShare={onShare}
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
        ) : null}
      </View>

      {/* Try-on result */}
      {tryOn ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setTryOn(null)}>
          <View style={styles.tryOnBackdrop}>
            <ThemedView type="background" style={styles.tryOnCard}>
              <View style={styles.tryOnHeader}>
                <ThemedText type="smallBold">Try on · {tryOn.item.name}</ThemedText>
                <Pressable onPress={() => setTryOn(null)} hitSlop={10}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Close
                  </ThemedText>
                </Pressable>
              </View>
              {tryOn.busy ? (
                <View style={styles.tryOnBody}>
                  <ActivityIndicator />
                  <ThemedText type="small" themeColor="textSecondary">
                    Fitting it on you…
                  </ThemedText>
                </View>
              ) : tryOn.result ? (
                <Image source={{ uri: tryOn.result }} style={styles.tryOnImg} contentFit="cover" />
              ) : (
                <ThemedText type="small" style={{ color: '#e24b4a' }}>
                  {tryOn.error}
                </ThemedText>
              )}
            </ThemedView>
          </View>
        </Modal>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { width: '100%', overflow: 'hidden', backgroundColor: '#000' },
  fallback: { backgroundColor: '#1a1a1a' },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 220,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  info: {
    position: 'absolute',
    left: Spacing.four,
    right: 90,
    bottom: 110,
    gap: Spacing.one,
  },
  handle: { color: '#fff', opacity: 0.9 },
  title: { color: '#fff' },
  sub: { color: '#fff', opacity: 0.8 },
  actions: { position: 'absolute', right: Spacing.three, bottom: 130, alignItems: 'center', gap: Spacing.four },
  actionBtn: { alignItems: 'center', gap: 2 },
  actionGlyph: { fontSize: 30, color: '#fff' },
  liked: { color: '#ff3b6b' },
  actionLabel: { color: '#fff' },
  tryOnBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  tryOnCard: { width: '100%', maxWidth: 420, borderRadius: Spacing.four, padding: Spacing.four, gap: Spacing.three },
  tryOnHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tryOnBody: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.six },
  tryOnImg: { width: '100%', aspectRatio: 1, borderRadius: Spacing.three },
});
