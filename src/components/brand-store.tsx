import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { openBrowserAsync } from 'expo-web-browser';

import { Spacing } from '@/constants/theme';
import { apiUrl } from '@/lib/api';

// The in-app storefront for one brand: an immersive, brand-coloured sheet with products
// grouped into collections/drops. Buying happens on the brand's website (Stripe checkout)
// when one exists; otherwise the store is browse-only here. Opened from the Market tab.

type Product = { id: string; slug: string; name: string; imageUrl: string | null; videoUrl: string | null; priceCents: number | null };
type Collection = { slug: string; name: string; season: string | null; coverImageUrl: string | null; products: Product[] };
type Brand = {
  slug: string;
  name: string;
  tagline: string | null;
  logoUrl: string | null;
  ogImageUrl: string | null;
  siteUrl: string | null;
  bgHex: string | null;
  textHex: string | null;
  accentHex: string | null;
};
type StoreData = { brand: Brand; productCount: number; collections: Collection[] };

const hex = (h: string | null | undefined, fallback: string) => {
  const v = (h ?? '').replace('#', '').trim();
  return /^[0-9a-fA-F]{6}$/.test(v) ? `#${v}` : fallback;
};
const price = (c: number | null) => (c == null ? '' : `$${(c / 100).toFixed(2)}`);

export function BrandStore({ slug, visible, onClose }: { slug: string | null; visible: boolean; onClose: () => void }) {
  const { width } = useWindowDimensions();
  const [data, setData] = useState<StoreData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const r = await fetch(apiUrl(`/api/store/${encodeURIComponent(slug)}`));
      setData((await r.json()) as StoreData);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (visible && slug) {
      setData(null);
      void load();
    }
  }, [visible, slug, load]);

  const brand = data?.brand;
  const bg = hex(brand?.bgHex, '#0b0b0f');
  const fg = hex(brand?.textHex, '#ffffff');
  const accent = hex(brand?.accentHex, '#c9a86a');
  const dim = `${fg}99`;
  const card = `${fg}14`;

  // Two columns with gutters that fit the sheet width.
  const gutter = Spacing.three;
  const colW = (Math.min(width, 720) - gutter * 3) / 2;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.fill, { backgroundColor: bg }]}>
        <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
          <View style={styles.topBar}>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={[styles.close, { color: dim }]}>✕ close</Text>
            </Pressable>
            {brand?.siteUrl ? (
              <Pressable onPress={() => brand.siteUrl && openBrowserAsync(brand.siteUrl)} hitSlop={8}>
                <Text style={[styles.visit, { color: accent }]}>visit website →</Text>
              </Pressable>
            ) : null}
          </View>

          {loading ? (
            <ActivityIndicator style={styles.center} color={accent} />
          ) : !brand ? (
            <View style={styles.center}>
              <Text style={{ color: fg }}>Couldn’t load this brand.</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
              {/* Brand header */}
              <View style={styles.header}>
                {brand.logoUrl ? (
                  <Image source={{ uri: brand.logoUrl }} style={styles.logo} contentFit="contain" />
                ) : null}
                <Text style={[styles.brandName, { color: fg }]}>{brand.name}</Text>
                {brand.tagline ? <Text style={[styles.tagline, { color: dim }]}>{brand.tagline}</Text> : null}
                <Text style={[styles.count, { color: accent }]}>
                  {data?.productCount} {data?.productCount === 1 ? 'piece' : 'pieces'}
                </Text>
              </View>

              {data?.collections.length ? (
                data.collections.map((c) => (
                  <View key={c.slug} style={styles.collection}>
                    <View style={styles.collectionHead}>
                      <Text style={[styles.collectionName, { color: fg }]}>{c.name}</Text>
                      {c.season ? (
                        <View style={[styles.seasonBadge, { borderColor: `${accent}66` }]}>
                          <Text style={[styles.seasonText, { color: accent }]}>{c.season.toUpperCase()}</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={[styles.grid, { gap: gutter }]}>
                      {c.products.map((p) => (
                        <Pressable
                          key={p.id}
                          style={[styles.productCard, { width: colW, backgroundColor: card }]}
                          onPress={() => brand.siteUrl && openBrowserAsync(brand.siteUrl)}
                        >
                          {p.imageUrl ? (
                            <Image source={{ uri: p.imageUrl }} style={[styles.productImg, { width: colW, height: colW }]} contentFit="cover" />
                          ) : (
                            <View style={[styles.productImg, { width: colW, height: colW, backgroundColor: `${fg}10` }]} />
                          )}
                          <View style={styles.productMeta}>
                            <Text style={[styles.productName, { color: fg }]} numberOfLines={1}>{p.name}</Text>
                            {p.priceCents != null ? <Text style={[styles.productPrice, { color: accent }]}>{price(p.priceCents)}</Text> : null}
                          </View>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ))
              ) : (
                <View style={styles.center}>
                  <Text style={{ color: dim }}>This brand hasn’t dropped any pieces yet.</Text>
                </View>
              )}
            </ScrollView>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.four, paddingVertical: Spacing.three },
  close: { fontSize: 13 },
  visit: { fontSize: 13, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.six },
  scroll: { paddingBottom: Spacing.six },
  header: { alignItems: 'center', paddingHorizontal: Spacing.four, paddingTop: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.two },
  logo: { width: 72, height: 72, borderRadius: 16 },
  brandName: { fontSize: 26, fontWeight: '800', letterSpacing: 0.5, textAlign: 'center' },
  tagline: { fontSize: 14, textAlign: 'center', maxWidth: 320 },
  count: { fontSize: 11, letterSpacing: 1.5, marginTop: 2 },
  collection: { paddingHorizontal: Spacing.three, marginBottom: Spacing.five },
  collectionHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, marginBottom: Spacing.three, paddingHorizontal: Spacing.one },
  collectionName: { fontSize: 18, fontWeight: '700' },
  seasonBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  seasonText: { fontSize: 9, letterSpacing: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  productCard: { borderRadius: 14, overflow: 'hidden' },
  productImg: { borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  productMeta: { padding: Spacing.three, gap: 2 },
  productName: { fontSize: 13, fontWeight: '600' },
  productPrice: { fontSize: 13, fontWeight: '700' },
});
