import { useEffect, useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlowButton } from '@/components/glow-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';
import { apiFetch, readJson } from '@/lib/api';
import { minRetailCents } from '@/lib/pricing';

// The product detail sheet — opens when a product on the canvas is tapped. Shows a large photo,
// colour swatches (tapping one swaps the photo to that colourway), available sizes and the starting
// price. Confirming applies the chosen colour to the canvas product. Data comes from
// /api/blank/:id/variants (size · colour · colourCode · base cost · photo per variant).

type Variant = { id: number; size: string; color: string; colorCode: string; priceCents: number; image: string };
type ColorOpt = { color: string; colorCode: string; image: string };

export function ProductDetailSheet({
  blank,
  initialColor,
  onClose,
  onApply,
}: {
  blank: { id: string; name: string; image?: string };
  /** The colour already applied to this product on the canvas, if any. */
  initialColor?: string;
  onClose: () => void;
  /** Confirmed colour → applied to the canvas product (photo + name). */
  onApply: (c: { color: string; image: string }) => void;
}) {
  const theme = useTheme();
  const [variants, setVariants] = useState<Variant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [color, setColor] = useState<string | undefined>(initialColor);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    apiFetch(`/api/blank/${blank.id}/variants`)
      .then(readJson<{ variants?: Variant[] }>)
      .then((d) => {
        if (alive) setVariants(d.variants ?? []);
      })
      .catch(() => {
        if (alive) setError(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [blank.id]);

  // Distinct colourways (one photo each), in catalogue order.
  const colors = useMemo<ColorOpt[]>(() => {
    const seen = new Set<string>();
    const out: ColorOpt[] = [];
    for (const v of variants) {
      if (!v.color || v.color === 'Default' || seen.has(v.color)) continue;
      seen.add(v.color);
      out.push({ color: v.color, colorCode: v.colorCode, image: v.image });
    }
    return out;
  }, [variants]);

  const sizes = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of variants) {
      if (v.size && !seen.has(v.size)) {
        seen.add(v.size);
        out.push(v.size);
      }
    }
    return out;
  }, [variants]);

  // Starting price = the cheapest variant's base cost lifted to the minimum allowed retail.
  const startingPrice = useMemo(() => {
    const costs = variants.map((v) => v.priceCents).filter((c) => c > 0);
    if (!costs.length) return null;
    return minRetailCents(Math.min(...costs));
  }, [variants]);

  const selected = useMemo(() => colors.find((c) => c.color === color) ?? colors[0], [colors, color]);
  const heroImage = selected?.image ?? blank.image;

  const apply = () => {
    if (selected) onApply({ color: selected.color, image: selected.image });
    onClose();
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ThemedView style={styles.fill}>
        <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
          <View style={styles.topBar}>
            <View style={styles.flexShrink}>
              <ThemedText type="smallBold" numberOfLines={1}>
                {blank.name}
              </ThemedText>
              {startingPrice != null ? (
                <ThemedText type="code" themeColor="textSecondary">
                  From ${(startingPrice / 100).toFixed(2)}
                </ThemedText>
              ) : null}
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <ThemedText type="small" themeColor="textSecondary">
                Close
              </ThemedText>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {/* Large product photo (swaps with the selected colourway). */}
            <View style={styles.hero}>
              {heroImage ? (
                <Image source={{ uri: heroImage }} style={styles.heroImg} contentFit="contain" />
              ) : (
                <ActivityIndicator color="#16161a" />
              )}
            </View>

            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={theme.text} />
              </View>
            ) : error ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.block}>
                Couldn’t load product details — check your connection.
              </ThemedText>
            ) : (
              <>
                {colors.length ? (
                  <View style={styles.block}>
                    <ThemedText type="code" themeColor="textSecondary">
                      {`COLOUR${selected ? ` — ${selected.color}` : ''}`}
                    </ThemedText>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatchRow}>
                      {colors.map((c) => {
                        const on = c.color === selected?.color;
                        return (
                          <Pressable key={c.color} onPress={() => setColor(c.color)} hitSlop={4}>
                            <View
                              style={[
                                styles.swatch,
                                { backgroundColor: c.colorCode },
                                on && { borderColor: theme.tint, borderWidth: 3 },
                              ]}
                            />
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>
                ) : (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.block}>
                    This product has no separate colourways (e.g. an all-over print covers the whole
                    garment) — just pick a size.
                  </ThemedText>
                )}

                {sizes.length ? (
                  <View style={styles.block}>
                    <ThemedText type="code" themeColor="textSecondary">
                      AVAILABLE SIZES
                    </ThemedText>
                    <View style={styles.sizeRow}>
                      {sizes.map((s) => (
                        <ThemedView key={s} type="backgroundElement" style={styles.sizeChip}>
                          <ThemedText type="small">{s}</ThemedText>
                        </ThemedView>
                      ))}
                    </View>
                  </View>
                ) : null}
              </>
            )}
          </ScrollView>

          {colors.length ? (
            <View style={styles.footer}>
              <GlowButton label={selected ? `Use ${selected.color}` : 'Use this colour'} onPress={apply} />
            </View>
          ) : null}
        </SafeAreaView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  body: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four, gap: Spacing.three },
  hero: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: Spacing.four,
    backgroundColor: '#f4f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heroImg: { width: '100%', height: '100%' },
  center: { paddingVertical: Spacing.four, alignItems: 'center' },
  block: { gap: Spacing.two },
  swatchRow: { gap: Spacing.three, paddingVertical: Spacing.one, paddingRight: Spacing.three },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128,128,128,0.5)',
  },
  sizeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  sizeChip: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.three, borderRadius: Spacing.two, minWidth: 44, alignItems: 'center' },
  footer: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
});
