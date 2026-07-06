import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { BrandStore } from '@/components/brand-store';
import { getBlockedBrands } from '@/lib/blocklist';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { withScreenFade } from '@/components/screen-fade';
import { GlowInput } from '@/components/glow-input';
import { apiUrl } from '@/lib/api';

// THE MARKET — an Amazon-style shopping feed: a vertical stack of horizontal rails with deliberately
// varied card sizes. A full-bleed HERO carousel for marketing punch, medium portrait rails for
// browsing, small compact rails for "more to explore". All cards funnel into the BrandStore sheet.

type Product = {
  id: string;
  name: string;
  imageUrl: string | null;
  videoUrl: string | null;
  storeName: string;
  storeSlug: string;
  storeTagline: string | null;
  priceCents: number | null;
};
type Brand = {
  id: string;
  name: string;
  slug: string;
  tagline: string | null;
  logoUrl: string | null;
  productCount: number;
  previews: string[];
};
type Collection = { slug: string; name: string; season: string | null; coverImageUrl: string | null; storeSlug: string; storeName: string };
type MarketData = { featured: Product[]; trending: Product[]; collections: Collection[]; brands: Brand[]; more: Product[] };

// Surfaces tuned to read over Eve's scrimmed net (app is forced dark): mostly-opaque cards with
// platinum hairlines instead of flat fills that melt into the background.
const CardBg = 'rgba(24,25,30,0.92)';
const HairLine = 'rgba(205,209,217,0.14)';
const FALLBACK = 'rgba(205,209,217,0.08)';

const price = (c: number | null) => (c != null ? `$${(c / 100).toFixed(2)}` : '');

// ── Hero: a full-bleed, paged marketing carousel. ──────────────────────────────────────────────
function Hero({ items, width, onOpen }: { items: Product[]; width: number; onOpen: (slug: string) => void }) {
  const [page, setPage] = useState(0);
  const h = Math.min(Math.round(width * 1.02), 460);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  return (
    <View>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={16}>
        {items.map((item) => (
          <Pressable key={item.id} onPress={() => onOpen(item.storeSlug)} style={{ width, height: h }}>
            {item.imageUrl ? (
              <Image source={{ uri: item.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" />
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: FALLBACK }]} />
            )}
            {/* Fake bottom gradient (no gradient lib) — two stacked scrims for a soft falloff. */}
            <View pointerEvents="none" style={[styles.heroScrimA, { height: h * 0.6 }]} />
            <View pointerEvents="none" style={[styles.heroScrimB, { height: h * 0.32 }]} />
            <View style={styles.heroText}>
              <ThemedText type="code" themeColor="tint" style={styles.heroKicker}>
                {item.storeName.toUpperCase()}
              </ThemedText>
              <ThemedText type="title" numberOfLines={2} style={styles.heroTitle}>
                {item.name}
              </ThemedText>
              <View style={styles.heroFoot}>
                {item.priceCents != null ? <ThemedText type="smallBold" style={styles.heroPrice}>{price(item.priceCents)}</ThemedText> : <View />}
                <View style={styles.shopPill}>
                  <ThemedText type="smallBold" style={styles.shopPillText}>Shop →</ThemedText>
                </View>
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>
      {items.length > 1 ? (
        <View style={styles.heroDots} pointerEvents="none">
          {items.map((it, i) => (
            <View key={it.id} style={[styles.dot, i === page && styles.dotOn]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ── A titled rail: header + a horizontal, edge-bleeding scroller of cards. ──────────────────────
function Rail({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.rail}>
      <ThemedText type="subtitle" style={styles.railTitle}>{title}</ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railRow}>
        {children}
      </ScrollView>
    </View>
  );
}

// Medium PORTRAIT product card (trending) — the main browse size.
function TrendingCard({ item, onOpen }: { item: Product; onOpen: (slug: string) => void }) {
  return (
    <Pressable style={styles.trendCard} onPress={() => onOpen(item.storeSlug)}>
      {item.imageUrl ? (
        <Image source={{ uri: item.imageUrl }} style={styles.trendImg} contentFit="cover" contentPosition="top" />
      ) : (
        <View style={[styles.trendImg, { backgroundColor: FALLBACK }]} />
      )}
      <ThemedText type="smallBold" numberOfLines={1} style={styles.pad}>{item.name}</ThemedText>
      <ThemedText type="code" themeColor="textSecondary" numberOfLines={1} style={styles.padTight}>
        {item.storeName}{item.priceCents != null ? ` · ${price(item.priceCents)}` : ''}
      </ThemedText>
    </Pressable>
  );
}

// LANDSCAPE brand tile — a preview shot + logo + count.
function BrandTile({ brand, onOpen }: { brand: Brand; onOpen: (slug: string) => void }) {
  return (
    <Pressable style={styles.brandTile} onPress={() => onOpen(brand.slug)}>
      {brand.previews[0] ? (
        <Image source={{ uri: brand.previews[0] }} style={styles.brandTileImg} contentFit="cover" contentPosition="top" />
      ) : (
        <View style={[styles.brandTileImg, { backgroundColor: FALLBACK }]} />
      )}
      <View style={styles.brandTileFoot}>
        {brand.logoUrl ? (
          <Image source={{ uri: brand.logoUrl }} style={styles.brandTileLogo} contentFit="cover" />
        ) : (
          <View style={[styles.brandTileLogo, { backgroundColor: FALLBACK }]} />
        )}
        <View style={styles.flex1}>
          <ThemedText type="smallBold" numberOfLines={1}>{brand.name}</ThemedText>
          <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
            {brand.productCount} {brand.productCount === 1 ? 'piece' : 'pieces'}
          </ThemedText>
        </View>
      </View>
    </Pressable>
  );
}

// LANDSCAPE collection (drop) card — cover + season badge.
function CollectionCard({ col, onOpen }: { col: Collection; onOpen: (slug: string) => void }) {
  return (
    <Pressable style={styles.colCard} onPress={() => onOpen(col.storeSlug)}>
      {col.coverImageUrl ? (
        <Image source={{ uri: col.coverImageUrl }} style={styles.colImg} contentFit="cover" contentPosition="top" />
      ) : (
        <View style={[styles.colImg, { backgroundColor: FALLBACK }]} />
      )}
      {col.season ? (
        <View style={styles.seasonBadge}>
          <ThemedText type="code" style={styles.seasonText}>{col.season.toUpperCase()}</ThemedText>
        </View>
      ) : null}
      <ThemedText type="smallBold" numberOfLines={1} style={styles.pad}>{col.name}</ThemedText>
      <ThemedText type="code" themeColor="textSecondary" numberOfLines={1} style={styles.padTight}>{col.storeName}</ThemedText>
    </Pressable>
  );
}

// SMALL square card — "more to explore", the lowest-commitment browse size.
function MiniCard({ item, onOpen }: { item: Product; onOpen: (slug: string) => void }) {
  return (
    <Pressable style={styles.miniCard} onPress={() => onOpen(item.storeSlug)}>
      {item.imageUrl ? (
        <Image source={{ uri: item.imageUrl }} style={styles.miniImg} contentFit="cover" contentPosition="top" />
      ) : (
        <View style={[styles.miniImg, { backgroundColor: FALLBACK }]} />
      )}
      <ThemedText type="code" themeColor="textSecondary" numberOfLines={1} style={styles.padTight}>
        {item.priceCents != null ? price(item.priceCents) : item.name}
      </ThemedText>
    </Pressable>
  );
}

// Compact brand ROW — the vertical search-results layout.
function BrandRow({ brand, onOpen }: { brand: Brand; onOpen: (slug: string) => void }) {
  return (
    <Pressable style={styles.brandRow} onPress={() => onOpen(brand.slug)}>
      {brand.logoUrl ? (
        <Image source={{ uri: brand.logoUrl }} style={styles.rowLogo} contentFit="cover" />
      ) : (
        <View style={[styles.rowLogo, { backgroundColor: FALLBACK }]} />
      )}
      <View style={styles.flex1}>
        <ThemedText type="smallBold" numberOfLines={1}>{brand.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {brand.tagline ?? `${brand.productCount} ${brand.productCount === 1 ? 'drop' : 'drops'}`}
        </ThemedText>
      </View>
      <ThemedText type="code" themeColor="tint">→</ThemedText>
    </Pressable>
  );
}

export default withScreenFade(MarketScreen, { eveThrough: true });

function MarketScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Brands this viewer has blocked (Apple Guideline 1.2). Reloaded when the brand sheet closes.
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const refreshBlocked = useCallback(() => { void getBlockedBrands().then((s) => setBlocked(new Set(s))); }, []);
  useEffect(() => { refreshBlocked(); }, [refreshBlocked]);

  const [storeSlug, setStoreSlug] = useState<string | null>(null);
  const searching = query.trim().length > 0;

  // Debounced fetch: refetch as the search query changes.
  useEffect(() => {
    const handle = setTimeout(() => {
      const q = query.trim();
      fetch(apiUrl(`/api/market${q ? `?q=${encodeURIComponent(q)}` : ''}`))
        .then((r) => r.json())
        .then((d: Partial<MarketData>) =>
          setData({ featured: d.featured ?? [], trending: d.trending ?? [], collections: d.collections ?? [], brands: d.brands ?? [], more: d.more ?? [] }),
        )
        .catch(() => {})
        .finally(() => { setLoading(false); setRefreshing(false); });
    }, query ? 300 : 0);
    return () => clearTimeout(handle);
  }, [query, refreshing]);

  // Deep-link from the feed's Buy tag: /market?store=<slug> opens that brand's store.
  const { store } = useLocalSearchParams<{ store?: string }>();
  useEffect(() => { if (store) setStoreSlug(store); }, [store]);

  const noBlock = <T extends { storeSlug: string }>(a: T[]) => a.filter((x) => !blocked.has(x.storeSlug));
  const featured = noBlock(data?.featured ?? []);
  const trending = noBlock(data?.trending ?? []);
  const more = noBlock(data?.more ?? []);
  const collections = noBlock(data?.collections ?? []);
  // Only brands with something to shop — an empty storefront ("0 pieces") is clutter in the feed.
  const brands = (data?.brands ?? []).filter((b) => !blocked.has(b.slug) && b.productCount > 0);

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.headerPad}>
          <ThemedText type="code" themeColor="tint" style={styles.eyebrow}>MARKET</ThemedText>
          <ThemedText type="title">Discover</ThemedText>
          <GlowInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search brands"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            containerStyle={styles.search}
          />
        </View>

        {loading ? (
          <ActivityIndicator style={styles.center} color={theme.tint} />
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.feed}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => setRefreshing(true)} tintColor={theme.textSecondary} />}
          >
            {searching ? (
              <View style={styles.searchWrap}>
                <ThemedText type="subtitle" style={styles.railTitle}>Brands</ThemedText>
                {brands.length ? (
                  brands.map((b) => <BrandRow key={b.id} brand={b} onOpen={setStoreSlug} />)
                ) : (
                  <View style={styles.emptyCard}>
                    <ThemedText type="small" themeColor="textSecondary">No brands match “{query.trim()}”.</ThemedText>
                  </View>
                )}
              </View>
            ) : (
              <>
                {featured.length ? <Hero items={featured} width={width} onOpen={setStoreSlug} /> : null}

                {trending.length ? (
                  <Rail title="Trending now">
                    {trending.map((item) => <TrendingCard key={item.id} item={item} onOpen={setStoreSlug} />)}
                  </Rail>
                ) : null}

                {brands.length ? (
                  <Rail title="Shop by brand">
                    {brands.map((b) => <BrandTile key={b.id} brand={b} onOpen={setStoreSlug} />)}
                  </Rail>
                ) : null}

                {collections.length ? (
                  <Rail title="Fresh drops">
                    {collections.map((c) => <CollectionCard key={`${c.storeSlug}-${c.slug}`} col={c} onOpen={setStoreSlug} />)}
                  </Rail>
                ) : null}

                {more.length ? (
                  <Rail title="More to explore">
                    {more.map((item) => <MiniCard key={`m-${item.id}`} item={item} onOpen={setStoreSlug} />)}
                  </Rail>
                ) : null}

                {!featured.length && !brands.length ? (
                  <View style={[styles.emptyCard, styles.headerPad]}>
                    <ThemedText type="small" themeColor="textSecondary">No live storefronts yet.</ThemedText>
                  </View>
                ) : null}
              </>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
      <BrandStore slug={storeSlug} visible={!!storeSlug} onClose={() => { setStoreSlug(null); refreshBlocked(); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  headerPad: { paddingHorizontal: Spacing.four, gap: Spacing.one, paddingTop: Spacing.three },
  eyebrow: { textTransform: 'uppercase', letterSpacing: 2 },
  search: { marginTop: Spacing.three },
  center: { marginTop: Spacing.six },
  feed: { paddingBottom: BottomTabInset + Spacing.six, gap: Spacing.six, paddingTop: Spacing.five },
  searchWrap: { paddingHorizontal: Spacing.four, gap: Spacing.two },

  // Hero
  heroScrimA: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(6,8,12,0.45)' },
  heroScrimB: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(6,8,12,0.6)' },
  heroText: { position: 'absolute', left: Spacing.four, right: Spacing.four, bottom: Spacing.five, gap: Spacing.two },
  heroKicker: { letterSpacing: 2 },
  heroTitle: { fontSize: 28, lineHeight: 32 },
  heroFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.two },
  heroPrice: { fontSize: 16 },
  shopPill: { backgroundColor: '#f4f4f6', borderRadius: 999, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
  shopPillText: { color: '#08080a' },
  heroDots: { position: 'absolute', bottom: Spacing.three, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotOn: { backgroundColor: '#fff', width: 7, height: 7, borderRadius: 4 },

  // Rail
  rail: { gap: Spacing.three },
  railTitle: { paddingHorizontal: Spacing.four },
  railRow: { gap: Spacing.three, paddingHorizontal: Spacing.four },

  // Trending (portrait)
  trendCard: { width: 158, gap: 2, paddingBottom: Spacing.two, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: HairLine, backgroundColor: CardBg, overflow: 'hidden' },
  trendImg: { width: 158, height: 208 },
  pad: { paddingHorizontal: Spacing.two, marginTop: Spacing.two },
  padTight: { paddingHorizontal: Spacing.two },

  // Brand tile (landscape)
  brandTile: { width: 264, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: HairLine, backgroundColor: CardBg, overflow: 'hidden' },
  brandTileImg: { width: 264, height: 148 },
  brandTileFoot: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three },
  brandTileLogo: { width: 34, height: 34, borderRadius: 10 },

  // Collection (landscape)
  colCard: { width: 236, gap: 2, paddingBottom: Spacing.two, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: HairLine, backgroundColor: CardBg, overflow: 'hidden' },
  colImg: { width: 236, height: 164 },
  seasonBadge: { position: 'absolute', top: Spacing.two, left: Spacing.two, backgroundColor: 'rgba(6,8,12,0.7)', borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 3 },
  seasonText: { color: '#cdd1d9', letterSpacing: 1.5, fontSize: 9 },

  // Mini (small square)
  miniCard: { width: 116, gap: 2 },
  miniImg: { width: 116, height: 116, borderRadius: 12 },

  // Brand row (search)
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: HairLine, backgroundColor: CardBg, padding: Spacing.three },
  rowLogo: { width: 46, height: 46, borderRadius: 12 },

  flex1: { flex: 1 },
  emptyCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: HairLine, backgroundColor: CardBg, padding: Spacing.four, alignItems: 'center' },
});
