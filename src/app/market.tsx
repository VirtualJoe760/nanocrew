import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { openBrowserAsync } from 'expo-web-browser';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
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

function price(cents: number | null): string {
  return cents != null ? `$${(cents / 100).toFixed(2)}` : '';
}

/** Resolve the public URL for a storefront, preferring a custom domain. */
function storeUrl(brand: Brand): string | null {
  if (brand.customDomain) return `https://${brand.customDomain}`;
  return brand.deploymentUrl ?? null;
}

function TrendingCard({ item }: { item: TrendingItem }) {
  return (
    <View style={styles.trendCard}>
      {item.imageUrl ? (
        <Image source={{ uri: item.imageUrl }} style={styles.trendImg} contentFit="cover" />
      ) : (
        <View style={[styles.trendImg, styles.imgFallback]} />
      )}
      <ThemedText type="smallBold" numberOfLines={1}>
        {item.name}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
        @{item.storeSlug}
        {item.priceCents != null ? ` · ${price(item.priceCents)}` : ''}
      </ThemedText>
    </View>
  );
}

function BrandCard({ brand }: { brand: Brand }) {
  const url = storeUrl(brand);
  return (
    <ThemedView type="backgroundElement" style={styles.brandCard}>
      <View style={styles.brandHeader}>
        {brand.logoUrl ? (
          <Image source={{ uri: brand.logoUrl }} style={styles.logo} contentFit="cover" />
        ) : (
          <View style={[styles.logo, styles.imgFallback]} />
        )}
        <View style={styles.brandMeta}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {brand.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {brand.tagline ?? `${brand.productCount} ${brand.productCount === 1 ? 'drop' : 'drops'}`}
          </ThemedText>
        </View>
        {url ? (
          <Pressable onPress={() => openBrowserAsync(url)} hitSlop={8} style={styles.visitBtn}>
            <ThemedText type="small" themeColor="text">
              Visit →
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      {brand.previews.length ? (
        <View style={styles.previewRow}>
          {brand.previews.map((src, i) => (
            <Image key={`${brand.id}-${i}`} source={{ uri: src }} style={styles.previewThumb} contentFit="cover" />
          ))}
        </View>
      ) : null}
    </ThemedView>
  );
}

export default function MarketScreen() {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

  const trending = data?.trending ?? [];
  const brands = data?.brands ?? [];
  const searching = query.trim().length > 0;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.inner}>
          <View style={styles.header}>
            <ThemedText type="code" style={styles.eyebrow}>
              Marketplace
            </ThemedText>
            <ThemedText type="title" style={styles.title}>
              Market
            </ThemedText>
          </View>

          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search brands"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.search, { backgroundColor: theme.backgroundElement, color: theme.text }]}
          />

          {loading ? (
            <ActivityIndicator style={styles.center} />
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
                  <ThemedText type="smallBold" style={styles.sectionTitle}>
                    Trending
                  </ThemedText>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.trendRow}
                  >
                    {trending.map((item) => (
                      <TrendingCard key={item.id} item={item} />
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              <View style={styles.section}>
                <ThemedText type="smallBold" style={styles.sectionTitle}>
                  {searching ? 'Brands' : 'All brands'}
                </ThemedText>
                {brands.length ? (
                  brands.map((brand) => <BrandCard key={brand.id} brand={brand} />)
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
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, alignItems: 'center' },
  inner: { flex: 1, width: '100%', maxWidth: MaxContentWidth, paddingHorizontal: Spacing.four },
  center: { marginTop: Spacing.six },
  header: { gap: Spacing.one, paddingTop: Spacing.three },
  eyebrow: { textTransform: 'uppercase' },
  title: {},
  search: {
    marginTop: Spacing.three,
    height: 44,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  scrollContent: { paddingTop: Spacing.four, paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.five },
  section: { gap: Spacing.three },
  sectionTitle: { textTransform: 'uppercase', opacity: 0.7 },
  trendRow: { gap: Spacing.three, paddingRight: Spacing.four },
  trendCard: { width: 140, gap: Spacing.one },
  trendImg: { width: 140, height: 140, borderRadius: Spacing.three },
  imgFallback: { backgroundColor: '#33343a' },
  brandCard: { borderRadius: Spacing.four, padding: Spacing.three, gap: Spacing.three },
  brandHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  logo: { width: 44, height: 44, borderRadius: 22 },
  brandMeta: { flex: 1, gap: 2 },
  visitBtn: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  previewRow: { flexDirection: 'row', gap: Spacing.two },
  previewThumb: { flex: 1, aspectRatio: 1, borderRadius: Spacing.two },
});
