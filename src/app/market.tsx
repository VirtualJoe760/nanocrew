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

// THE MARKET — a tabbed browser: one nav, several ways to shop. DISCOVER is the editorial home
// (a featured hero + fresh drops + a curated grid); SHOP is a filterable product grid; BRANDS is
// the storefront directory. A search finds a specific brand from any tab. All cards open the
// BrandStore sheet. Opaque + card-based, so the persistent Eve stays hidden and frozen behind it.

type Product = {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  videoUrl: string | null;
  category: string | null;
  storeName: string;
  storeSlug: string;
  storeTagline: string | null;
  priceCents: number | null;
};
type Brand = { id: string; name: string; slug: string; tagline: string | null; logoUrl: string | null; productCount: number; previews: string[] };
type Collection = { slug: string; name: string; season: string | null; coverImageUrl: string | null; storeSlug: string; storeName: string };
type MarketData = { featured: Product[]; trending: Product[]; collections: Collection[]; brands: Brand[]; more: Product[] };

type Tab = 'discover' | 'shop' | 'brands';
const TABS: { key: Tab; label: string }[] = [
  { key: 'discover', label: 'Discover' },
  { key: 'shop', label: 'Shop' },
  { key: 'brands', label: 'Brands' },
];

const CardBg = 'rgba(24,25,30,0.92)';
const HairLine = 'rgba(205,209,217,0.14)';
const FALLBACK = 'rgba(205,209,217,0.08)';
const price = (c: number | null) => (c != null ? `$${(c / 100).toFixed(2)}` : '');

// ── Discover: a full-bleed, paged marketing hero. ──────────────────────────────────────────────
function Hero({ items, width, onOpen }: { items: Product[]; width: number; onOpen: (slug: string, productSlug?: string) => void }) {
  const [page, setPage] = useState(0);
  const h = Math.min(Math.round(width * 1.02), 460);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  return (
    <View>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={16}>
        {items.map((item) => (
          <Pressable key={item.id} onPress={() => onOpen(item.storeSlug, item.slug)} style={{ width, height: h }}>
            {item.imageUrl ? (
              <Image source={{ uri: item.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" />
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: FALLBACK }]} />
            )}
            <View pointerEvents="none" style={[styles.heroScrimA, { height: h * 0.6 }]} />
            <View pointerEvents="none" style={[styles.heroScrimB, { height: h * 0.32 }]} />
            <View style={styles.heroText}>
              <ThemedText type="code" themeColor="tint" style={styles.heroKicker}>{item.storeName.toUpperCase()}</ThemedText>
              <ThemedText type="title" numberOfLines={2} style={styles.heroTitle}>{item.name}</ThemedText>
              <View style={styles.heroFoot}>
                {item.priceCents != null ? <ThemedText type="smallBold" style={styles.heroPrice}>{price(item.priceCents)}</ThemedText> : <View />}
                <View style={styles.shopPill}><ThemedText type="smallBold" style={styles.shopPillText}>Shop →</ThemedText></View>
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>
      {items.length > 1 ? (
        <View style={styles.heroDots} pointerEvents="none">
          {items.map((it, i) => <View key={it.id} style={[styles.dot, i === page && styles.dotOn]} />)}
        </View>
      ) : null}
    </View>
  );
}

function Rail({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.rail}>
      <ThemedText type="subtitle" style={styles.railTitle}>{title}</ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railRow}>{children}</ScrollView>
    </View>
  );
}

function CollectionCard({ col, onOpen }: { col: Collection; onOpen: (slug: string) => void }) {
  return (
    <Pressable style={styles.colCard} onPress={() => onOpen(col.storeSlug)}>
      {col.coverImageUrl ? (
        <Image source={{ uri: col.coverImageUrl }} style={styles.colImg} contentFit="cover" contentPosition="top" />
      ) : (
        <View style={[styles.colImg, { backgroundColor: FALLBACK }]} />
      )}
      {col.season ? <View style={styles.seasonBadge}><ThemedText type="code" style={styles.seasonText}>{col.season.toUpperCase()}</ThemedText></View> : null}
      <ThemedText type="smallBold" numberOfLines={1} style={styles.pad}>{col.name}</ThemedText>
      <ThemedText type="code" themeColor="textSecondary" numberOfLines={1} style={styles.padTight}>{col.storeName}</ThemedText>
    </Pressable>
  );
}

// A flexible-width product card for the 2-up grids (Shop + Discover's curated section).
function ProductCard({ item, w, onOpen }: { item: Product; w: number; onOpen: (slug: string, productSlug?: string) => void }) {
  return (
    <Pressable style={[styles.pCard, { width: w }]} onPress={() => onOpen(item.storeSlug, item.slug)}>
      {item.imageUrl ? (
        <Image source={{ uri: item.imageUrl }} style={{ width: w, height: Math.round(w * 1.25) }} contentFit="cover" contentPosition="top" />
      ) : (
        <View style={{ width: w, height: Math.round(w * 1.25), backgroundColor: FALLBACK }} />
      )}
      <ThemedText type="smallBold" numberOfLines={1} style={styles.pad}>{item.name}</ThemedText>
      <ThemedText type="code" themeColor="textSecondary" numberOfLines={1} style={styles.padTight}>
        {item.storeName}{item.priceCents != null ? ` · ${price(item.priceCents)}` : ''}
      </ThemedText>
    </Pressable>
  );
}

// A brand tile for the directory grid — preview shot + logo + count.
function BrandTile({ brand, w, onOpen }: { brand: Brand; w: number; onOpen: (slug: string) => void }) {
  return (
    <Pressable style={[styles.brandTile, { width: w }]} onPress={() => onOpen(brand.slug)}>
      {brand.previews[0] ? (
        <Image source={{ uri: brand.previews[0] }} style={{ width: w, height: Math.round(w * 0.66) }} contentFit="cover" contentPosition="top" />
      ) : (
        <View style={{ width: w, height: Math.round(w * 0.66), backgroundColor: FALLBACK }} />
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

// A compact brand row — the search-results layout.
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

export default withScreenFade(MarketScreen);

function MarketScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<Tab>('discover');
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('All');
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [storeSlug, setStoreSlug] = useState<string | null>(null);
  // Product tiles deep-open the PRODUCT inside the brand sheet; brand tiles leave this null and
  // land on the brand itself (B11 — every tile used to drop the product and open the brand).
  const [openProductSlug, setOpenProductSlug] = useState<string | null>(null);
  const openStore = useCallback((slug: string, productSlug?: string) => {
    setOpenProductSlug(productSlug ?? null);
    setStoreSlug(slug);
  }, []);

  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const refreshBlocked = useCallback(() => { void getBlockedBrands().then((s) => setBlocked(new Set(s))); }, []);
  useEffect(() => { refreshBlocked(); }, [refreshBlocked]);

  useEffect(() => {
    const handle = setTimeout(() => {
      const q = query.trim();
      fetch(apiUrl(`/api/market${q ? `?q=${encodeURIComponent(q)}` : ''}`))
        .then((r) => r.json())
        .then((d: Partial<MarketData>) => setData({ featured: d.featured ?? [], trending: d.trending ?? [], collections: d.collections ?? [], brands: d.brands ?? [], more: d.more ?? [] }))
        .catch(() => {})
        .finally(() => { setLoading(false); setRefreshing(false); });
    }, query ? 300 : 0);
    return () => clearTimeout(handle);
  }, [query, refreshing]);

  const { store } = useLocalSearchParams<{ store?: string }>();
  useEffect(() => { if (store) setStoreSlug(store); }, [store]);

  const searching = query.trim().length > 0;
  const col = Math.floor((width - Spacing.four * 2 - Spacing.three) / 2);
  const noBlock = <T extends { storeSlug: string }>(a: T[]) => a.filter((x) => !blocked.has(x.storeSlug));
  const featured = noBlock(data?.featured ?? []);
  const trending = noBlock(data?.trending ?? []);
  const more = noBlock(data?.more ?? []);
  const collections = noBlock(data?.collections ?? []);
  const brands = (data?.brands ?? []).filter((b) => !blocked.has(b.slug) && b.productCount > 0);

  // Shop: category chips derived from the products in the pool.
  const cats = ['All', ...Array.from(new Set(more.map((p) => p.category).filter((c): c is string => !!c)))];
  const shopItems = cat === 'All' ? more : more.filter((p) => p.category === cat);

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.headerPad}>
          <ThemedText type="code" themeColor="tint" style={styles.eyebrow}>MARKET</ThemedText>
          <ThemedText type="title">Discover</ThemedText>
          <GlowInput value={query} onChangeText={setQuery} placeholder="Search brands" autoCapitalize="none" autoCorrect={false} returnKeyType="search" containerStyle={styles.search} />
        </View>

        {/* Nav tabs — how you want to browse. Hidden while searching (results take over). */}
        {!searching ? (
          <View style={styles.tabNav}>
            {TABS.map((t) => (
              <Pressable key={t.key} onPress={() => setTab(t.key)} style={styles.tabItem}>
                <ThemedText type="smallBold" style={{ color: tab === t.key ? theme.text : theme.textSecondary, opacity: tab === t.key ? 1 : 0.6 }}>{t.label}</ThemedText>
                <View style={[styles.tabUnderline, { backgroundColor: tab === t.key ? theme.tint : 'transparent' }]} />
              </Pressable>
            ))}
          </View>
        ) : null}

        {loading ? (
          <ActivityIndicator style={styles.center} color={theme.tint} />
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.feed}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => setRefreshing(true)} tintColor={theme.textSecondary} />}
          >
            {searching ? (
              <View style={styles.padWrap}>
                {brands.length ? (
                  brands.map((b) => <BrandRow key={b.id} brand={b} onOpen={openStore} />)
                ) : (
                  <View style={styles.emptyCard}><ThemedText type="small" themeColor="textSecondary">No brands match “{query.trim()}”.</ThemedText></View>
                )}
              </View>
            ) : tab === 'discover' ? (
              <>
                {featured.length ? <Hero items={featured} width={width} onOpen={openStore} /> : null}
                {collections.length ? (
                  <Rail title="Fresh drops">
                    {collections.map((c) => <CollectionCard key={`${c.storeSlug}-${c.slug}`} col={c} onOpen={openStore} />)}
                  </Rail>
                ) : null}
                {trending.length ? (
                  <View style={styles.section}>
                    <ThemedText type="subtitle" style={styles.railTitle}>New this week</ThemedText>
                    <View style={styles.grid}>
                      {trending.map((item) => <ProductCard key={item.id} item={item} w={col} onOpen={openStore} />)}
                    </View>
                  </View>
                ) : null}
                {!featured.length && !trending.length ? (
                  <View style={[styles.emptyCard, styles.padWrap]}><ThemedText type="small" themeColor="textSecondary">No live storefronts yet.</ThemedText></View>
                ) : null}
              </>
            ) : tab === 'shop' ? (
              <>
                {cats.length > 1 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                    {cats.map((c) => (
                      <Pressable key={c} onPress={() => setCat(c)} style={[styles.chip, cat === c && { backgroundColor: theme.tint, borderColor: theme.tint }]}>
                        <ThemedText type="code" style={{ color: cat === c ? '#08080a' : theme.textSecondary }}>{c}</ThemedText>
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : null}
                <View style={[styles.grid, styles.padWrap]}>
                  {shopItems.length ? (
                    shopItems.map((item) => <ProductCard key={item.id} item={item} w={col} onOpen={openStore} />)
                  ) : (
                    <ThemedText type="small" themeColor="textSecondary">Nothing here yet.</ThemedText>
                  )}
                </View>
              </>
            ) : (
              <View style={[styles.grid, styles.padWrap]}>
                {brands.length ? (
                  brands.map((b) => <BrandTile key={b.id} brand={b} w={col} onOpen={openStore} />)
                ) : (
                  <View style={styles.emptyCard}><ThemedText type="small" themeColor="textSecondary">No live storefronts yet.</ThemedText></View>
                )}
              </View>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
      <BrandStore
        slug={storeSlug}
        initialProductSlug={openProductSlug}
        visible={!!storeSlug}
        onClose={() => { setStoreSlug(null); setOpenProductSlug(null); refreshBlocked(); }}
      />
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
  feed: { paddingBottom: BottomTabInset + Spacing.six, gap: Spacing.six, paddingTop: Spacing.four },
  padWrap: { paddingHorizontal: Spacing.four, gap: Spacing.two },
  section: { gap: Spacing.three },

  tabNav: { flexDirection: 'row', gap: Spacing.five, paddingHorizontal: Spacing.four, marginTop: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HairLine },
  tabItem: { paddingBottom: Spacing.two, alignItems: 'center', gap: Spacing.two },
  tabUnderline: { height: 2, width: '100%', borderRadius: 2 },

  chipRow: { gap: Spacing.two, paddingHorizontal: Spacing.four, paddingBottom: Spacing.one },
  chip: { borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: HairLine, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },

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

  rail: { gap: Spacing.three },
  railTitle: { paddingHorizontal: Spacing.four },
  railRow: { gap: Spacing.three, paddingHorizontal: Spacing.four },

  pCard: { gap: 2, paddingBottom: Spacing.two, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: HairLine, backgroundColor: CardBg, overflow: 'hidden' },
  pad: { paddingHorizontal: Spacing.two, marginTop: Spacing.two },
  padTight: { paddingHorizontal: Spacing.two },

  colCard: { width: 236, gap: 2, paddingBottom: Spacing.two, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: HairLine, backgroundColor: CardBg, overflow: 'hidden' },
  colImg: { width: 236, height: 164 },
  seasonBadge: { position: 'absolute', top: Spacing.two, left: Spacing.two, backgroundColor: 'rgba(6,8,12,0.7)', borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 3 },
  seasonText: { color: '#cdd1d9', letterSpacing: 1.5, fontSize: 9 },

  brandTile: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: HairLine, backgroundColor: CardBg, overflow: 'hidden' },
  brandTileFoot: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three },
  brandTileLogo: { width: 34, height: 34, borderRadius: 10 },

  brandRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: HairLine, backgroundColor: CardBg, padding: Spacing.three },
  rowLogo: { width: 46, height: 46, borderRadius: 12 },

  flex1: { flex: 1 },
  emptyCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: HairLine, backgroundColor: CardBg, padding: Spacing.four, alignItems: 'center' },
});
