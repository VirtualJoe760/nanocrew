import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { openBrowserAsync } from 'expo-web-browser';

import { Spacing } from '@/constants/theme';
import { apiUrl } from '@/lib/api';
import { SquareCarousel } from '@/components/square-carousel';

// The in-app product page: a square image carousel, copy, size/colour picker, and an in-app
// Buy that runs through our POS (same Stripe→Printful pipeline as the website). Prices match
// the website — physical goods take no Apple cut, so there's no in-app markup.

type Variant = { id: string; sku: string | null; size: string | null; color: string | null; retailPriceCents: number | null; inStock: boolean };
type ProductData = {
  product: { id: string; slug: string; name: string; descriptionMd: string | null; images: string[]; videoUrl: string | null };
  variants: Variant[];
};

const money = (c: number | null | undefined) => (c == null ? '' : `$${(c / 100).toFixed(2)}`);
const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];

export function ProductDetail({
  slug,
  productSlug,
  colors,
  visible,
  onClose,
}: {
  slug: string;
  productSlug: string | null;
  colors: { bg: string; fg: string; accent: string };
  visible: boolean;
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheetW = Math.min(width, 720);

  const [data, setData] = useState<ProductData | null>(null);
  const [loading, setLoading] = useState(true);
  const [color, setColor] = useState<string | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const { bg, fg, accent } = colors;
  const dim = `${fg}99`;
  const cardBg = `${fg}12`;

  const load = useCallback(async () => {
    if (!productSlug) return;
    setLoading(true);
    setNote(null);
    try {
      const r = await fetch(apiUrl(`/api/store/${encodeURIComponent(slug)}/products/${encodeURIComponent(productSlug)}`));
      const d = (await r.json()) as ProductData;
      setData(d);
      // Default to the first in-stock variant (or the first overall).
      const first = d.variants.find((v) => v.inStock) ?? d.variants[0];
      setColor(first?.color ?? null);
      setSize(first?.size ?? null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [slug, productSlug]);

  useEffect(() => {
    if (visible && productSlug) {
      setData(null);
      void load();
    }
  }, [visible, productSlug, load]);

  const variants = data?.variants ?? [];
  const allColors = useMemo(() => uniq(variants.map((v) => v.color)), [variants]);
  const allSizes = useMemo(() => uniq(variants.map((v) => v.size)), [variants]);
  // Sizes available for the currently-selected colour (or all sizes if colour isn't a dimension).
  const sizesForColor = useMemo(
    () => (allColors.length ? uniq(variants.filter((v) => v.color === color).map((v) => v.size)) : allSizes),
    [variants, allColors.length, allSizes, color],
  );

  const selected = useMemo(
    () =>
      variants.find(
        (v) => (allColors.length ? v.color === color : true) && (allSizes.length ? v.size === size : true),
      ) ?? null,
    [variants, allColors.length, allSizes.length, color, size],
  );

  const pickColor = (c: string) => {
    setColor(c);
    // Keep size if the new colour has it; else jump to its first available size.
    const sizes = uniq(variants.filter((v) => v.color === c).map((v) => v.size));
    if (allSizes.length && !sizes.includes(size ?? '')) setSize(sizes[0] ?? null);
  };

  const priceLabel = selected
    ? money(selected.retailPriceCents)
    : (() => {
        const ps = variants.map((v) => v.retailPriceCents).filter((p): p is number => p != null);
        if (!ps.length) return '';
        const lo = Math.min(...ps), hi = Math.max(...ps);
        return lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`;
      })();

  const canBuy = !!selected && selected.inStock && !buying;

  const buy = async () => {
    if (!selected) {
      setNote('Pick an available option first.');
      return;
    }
    setBuying(true);
    setNote(null);
    try {
      const r = await fetch(apiUrl(`/api/store/${encodeURIComponent(slug)}/checkout`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ variantId: selected.id, quantity: 1 }] }),
      });
      const d = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
      if (r.status === 503) {
        setNote('Checkout isn’t live yet — it opens once payments are turned on.');
        return;
      }
      if (!r.ok || !d.url) {
        setNote(d.error ?? 'Could not start checkout. Please try again.');
        return;
      }
      await openBrowserAsync(d.url);
    } catch {
      setNote('Could not start checkout. Please try again.');
    } finally {
      setBuying(false);
    }
  };

  const product = data?.product;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.fill, { backgroundColor: bg }]}>
        <SafeAreaView style={styles.fill} edges={['bottom']}>
          <View style={[styles.topBar, { paddingTop: Math.max(insets.top, Spacing.three) }]}>
            <Pressable onPress={onClose} hitSlop={16}>
              <Text style={[styles.close, { color: dim }]}>← back</Text>
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator style={styles.center} color={accent} />
          ) : !product ? (
            <View style={styles.center}>
              <Text style={{ color: fg }}>Couldn’t load this product.</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
              <SquareCarousel images={product.images} size={sheetW} accent={accent} />

              <View style={styles.body}>
                <Text style={[styles.name, { color: fg }]}>{product.name}</Text>
                <Text style={[styles.price, { color: accent }]}>{priceLabel}</Text>

                {allColors.length > 1 || (allColors.length === 1 && allSizes.length) ? (
                  <View style={styles.optBlock}>
                    <Text style={[styles.optLabel, { color: dim }]}>COLOR{color ? ` · ${color}` : ''}</Text>
                    <View style={styles.chips}>
                      {allColors.map((c) => {
                        const on = c === color;
                        return (
                          <Pressable
                            key={c}
                            onPress={() => pickColor(c)}
                            style={[styles.chip, { borderColor: on ? accent : `${fg}33`, backgroundColor: on ? accent : 'transparent' }]}
                          >
                            <Text style={[styles.chipText, { color: on ? bg : fg }]}>{c}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ) : null}

                {allSizes.length ? (
                  <View style={styles.optBlock}>
                    <Text style={[styles.optLabel, { color: dim }]}>SIZE{size ? ` · ${size}` : ''}</Text>
                    <View style={styles.chips}>
                      {allSizes.map((s) => {
                        const available = sizesForColor.includes(s);
                        const on = s === size;
                        return (
                          <Pressable
                            key={s}
                            disabled={!available}
                            onPress={() => setSize(s)}
                            style={[
                              styles.chip,
                              {
                                borderColor: on ? accent : `${fg}33`,
                                backgroundColor: on ? accent : 'transparent',
                                opacity: available ? 1 : 0.3,
                              },
                            ]}
                          >
                            <Text style={[styles.chipText, { color: on ? bg : fg }]}>{s}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ) : null}

                {product.descriptionMd ? (
                  <Text style={[styles.desc, { color: dim }]}>{product.descriptionMd}</Text>
                ) : null}

                {note ? <Text style={[styles.note, { color: accent }]}>{note}</Text> : null}
              </View>
            </ScrollView>
          )}

          {product ? (
            <View style={[styles.buyBar, { borderTopColor: `${fg}1a`, paddingBottom: Math.max(insets.bottom, Spacing.three) }]}>
              <Pressable
                onPress={buy}
                disabled={!canBuy}
                style={[styles.buyBtn, { backgroundColor: accent, opacity: canBuy ? 1 : 0.5 }]}
              >
                {buying ? (
                  <ActivityIndicator color={bg} />
                ) : (
                  <Text style={[styles.buyText, { color: bg }]}>
                    {selected && !selected.inStock ? 'Sold out' : `Buy${priceLabel ? ` · ${priceLabel}` : ''}`}
                  </Text>
                )}
              </Pressable>
            </View>
          ) : null}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.four, paddingVertical: Spacing.three },
  close: { fontSize: 14, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.six },
  scroll: { paddingBottom: Spacing.six },
  body: { paddingHorizontal: Spacing.four, paddingTop: Spacing.four, gap: Spacing.three },
  name: { fontSize: 24, fontWeight: '800', letterSpacing: 0.3 },
  price: { fontSize: 20, fontWeight: '700' },
  optBlock: { gap: Spacing.two, marginTop: Spacing.two },
  optLabel: { fontSize: 11, letterSpacing: 1.2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, minWidth: 44, alignItems: 'center' },
  chipText: { fontSize: 13, fontWeight: '700' },
  desc: { fontSize: 14, lineHeight: 21, marginTop: Spacing.two },
  note: { fontSize: 13, marginTop: Spacing.two },
  buyBar: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth },
  buyBtn: { borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.four },
  buyText: { fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
});
