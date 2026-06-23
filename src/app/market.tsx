import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandStore } from '@/components/brand-store';
import { getBlockedBrands } from '@/lib/blocklist';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { withScreenFade } from '@/components/screen-fade';
import { GlowInput } from '@/components/glow-input';
import { apiUrl } from '@/lib/api';

type TrendingItem = {
  id: string;
  name: string;
  imageUrl: string | null;
  videoUrl: string | null;
  storeName: string;
  storeSlug: string;
  priceCents: number | null;
};

type Brand = {
  id: string;
  name: string;
  slug: string;
  tagline: string | null;
  logoUrl: string | null;
  deploymentUrl: string | null;
  customDomain: string | null;
  productCount: number;
  previews: string[];
};

type MarketData = { trending: TrendingItem[]; brands: Brand[] };

const price = (cents: number | null) => (cents != null ? `$${(cents / 100).toFixed(2)}` : '');

/** Resolve the public website URL for a storefront, preferring a custom domain. */
function storeUrl(brand: Brand): string | null {
  if (brand.customDomain) return `https://${brand.customDomain}`;
  return brand.deploymentUrl ?? null;
}

/** A trending product — tapping opens its brand's in-app store page. */
function TrendingCard({
  item,
  onOpen,
  fallback,
}: {
  item: TrendingItem;
  onOpen: (slug: string) => void;
  fallback: string;
}) {
  return (
    <Pressable style={styles.trendCard} onPress={() => onOpen(item.storeSlug)}>
      {item.imageUrl ? (
        <Image source={{ uri: item.imageUrl }} style={styles.trendImg} contentFit="cover" />
      ) : (
        <View style={[styles.trendImg, { backgroundColor: fallback }]} />
      )}
      <ThemedText type="smallBold" numberOfLines={1} style={styles.trendName}>
        {item.name}
      </ThemedText>
      <ThemedText type="code" themeColor="textSecondary" numberOfLines={1} style={styles.trendMeta}>
        {item.storeName}
        {item.priceCents != null ? ` · ${price(item.priceCents)}` : ''}
      </ThemedText>
    </Pressable>
  );
}

/** A brand card — the whole card opens the in-app store page; a separate pill opens the website. */
function BrandCard({
  brand,
  onOpen,
  fallback,
  line,
}: {
  brand: Brand;
  onOpen: (slug: string) => void;
  fallback: string;
  line: string;
}) {
  const url = storeUrl(brand);
  return (
    <Pressable onPress={() => onOpen(brand.slug)}>
      <ThemedView type="backgroundElement" style={[styles.brandCard, { borderColor: line }]}>
        <View style={styles.brandHeader}>
          {brand.logoUrl ? (
            <Image source={{ uri: brand.logoUrl }} style={styles.logo} contentFit="cover" />
          ) : (
            <View style={[styles.logo, { backgroundColor: fallback }]} />
          )}
          <View style={styles.brandMeta}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {brand.name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {brand.tagline ?? `${brand.productCount} ${brand.productCount === 1 ? 'drop' : 'drops'}`}
            </ThemedText>
          </View>
          <ThemedText type="code" themeColor="textSecondary" style={styles.count}>
            {brand.productCount}
          </ThemedText>
        </View>

        {brand.previews.length ? (
          <View style={styles.previewRow}>
            {brand.previews.slice(0, 4).map((src, i) => (
              <Image key={`${brand.id}-${i}`} source={{ uri: src }} style={styles.previewThumb} contentFit="cover" />
            ))}
          </View>
        ) : null}

        <View style={[styles.brandFooter, { borderTopColor: line }]}>
          <ThemedText type="code" themeColor="tint">
            Open store →
          </ThemedText>
          {url ? (
            <Pressable onPress={() => openBrowserAsync(url)} hitSlop={10} style={styles.visitPill}>
              <ThemedText type="code" themeColor="textSecondary">
                Website ↗
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      </ThemedView>
    </Pressable>
  );
}

export default withScreenFade(MarketScreen, { background: true });

function MarketScreen() {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Brands this viewer has blocked (Apple Guideline 1.2). Reloaded when the brand sheet closes so a
  // block takes effect immediately on return to the Market.
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const refreshBlocked = useCallback(() => { void getBlockedBrands().then((s) => setBlocked(new Set(s))); }, []);
  useEffect(() => { refreshBlocked(); }, [refreshBlocked]);

  // A subtle fill/border that reads on either mode (no hardcoded greys).
  const fallback = theme.backgroundSelected;
  const line = theme.backgroundSelected;

  // Debounced fetch: refetch as the brand search query changes.
  useEffect(() => {
    const handle = setTimeout(() => {
      const q = query.trim();
      fetch(apiUrl(`/api/market${q ? `?q=${encodeURIComponent(q)}` : ''}`))
        .then((r) => r.json())
        .then((d: MarketData & { error?: string }) =>
          setData({ trending: d.trending ?? [], brands: d.brands ?? [] }),
        )
        .catch(() => {})
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        });
    }, query ? 300 : 0);
    return () => clearTimeout(handle);
  }, [query, refreshing]);

  const trending = (data?.trending ?? []).filter((t) => !blocked.has(t.storeSlug));
  const brands = (data?.brands ?? []).filter((b) => !blocked.has(b.slug));
  const searching = query.trim().length > 0;
  const [storeSlug, setStoreSlug] = useState<string | null>(null);

  // Deep-link from the feed's Buy tag: /market?store=<slug> opens that brand's store.
  const { store } = useLocalSearchParams<{ store?: string }>();
  useEffect(() => {
    if (store) setStoreSlug(store);
  }, [store]);

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.inner}>
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
              <ThemedText type="code" themeColor="tint" style={styles.eyebrow}>
                MARKET
              </ThemedText>
            </View>
            <ThemedText type="title" style={styles.title}>
              Discover
            </ThemedText>
          </View>

          <GlowInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search brands"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            containerStyle={styles.search}
          />

          {loading ? (
            <ActivityIndicator style={styles.center} color={theme.tint} />
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => setRefreshing(true)}
                  tintColor={theme.textSecondary}
                />
              }
            >
              {!searching && trending.length ? (
                <View style={styles.section}>
                  <ThemedText type="code" themeColor="textSecondary" style={styles.sectionTitle}>
                    Trending
                  </ThemedText>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.trendRow}
                  >
                    {trending.map((item) => (
                      <TrendingCard key={item.id} item={item} onOpen={setStoreSlug} fallback={fallback} />
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              <View style={styles.section}>
                <ThemedText type="code" themeColor="textSecondary" style={styles.sectionTitle}>
                  {searching ? 'Brands' : 'All brands'}
                </ThemedText>
                {brands.length ? (
                  brands.map((brand) => (
                    <BrandCard key={brand.id} brand={brand} onOpen={setStoreSlug} fallback={fallback} line={line} />
                  ))
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">
                    {searching ? `No brands match "${query.trim()}".` : 'No live storefronts yet.'}
                  </ThemedText>
                )}
              </View>
            </ScrollView>
          )}
        </View>
      </SafeAreaView>
      <BrandStore slug={storeSlug} visible={!!storeSlug} onClose={() => { setStoreSlug(null); refreshBlocked(); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, alignItems: 'center' },
  inner: { flex: 1, width: '100%', maxWidth: MaxContentWidth, paddingHorizontal: Spacing.four },
  center: { marginTop: Spacing.six },
  header: { gap: Spacing.one, paddingTop: Spacing.three },
  eyebrow: { textTransform: 'uppercase', letterSpacing: 2 },
  title: {},
  search: { marginTop: Spacing.three },
  scrollContent: { paddingTop: Spacing.five, paddingBottom: BottomTabInset + Spacing.five, gap: Spacing.six },
  section: { gap: Spacing.three },
  sectionTitle: { textTransform: 'uppercase', letterSpacing: 1.5 },
  trendRow: { gap: Spacing.three, paddingRight: Spacing.four },
  trendCard: { width: 150, gap: Spacing.one },
  trendImg: { width: 150, height: 150, borderRadius: Spacing.three },
  trendName: { marginTop: Spacing.one },
  trendMeta: {},
  brandCard: { borderRadius: Spacing.four, borderWidth: 1, padding: Spacing.three, gap: Spacing.three },
  brandHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  logo: { width: 46, height: 46, borderRadius: 12 },
  brandMeta: { flex: 1, gap: 2 },
  count: { fontSize: 12 },
  previewRow: { flexDirection: 'row', gap: Spacing.two },
  previewThumb: { flex: 1, aspectRatio: 1, borderRadius: Spacing.two },
  brandFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingTop: Spacing.three,
  },
  visitPill: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
});
