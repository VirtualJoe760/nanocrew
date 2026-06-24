import { useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlowButton } from '@/components/glow-button';
import { GlowInput } from '@/components/glow-input';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';
import type { BlankCategory, CatalogBlank } from '@/lib/printful';

// The full-screen product picker — the visual drill-down that replaces the old bottom products dock.
// Hierarchy: Supplier → Type of product → Gender → Product category → Product. Supplier is a single
// option today (Printful), so it's shown in the breadcrumb and auto-skipped; when own-store /
// imported suppliers land it becomes a selectable first level. A "Popular" rail sits IN FRONT of the
// subcategories at every browse level. Products are MULTI-SELECT: tap to add several, then the bottom
// "Add N products" control drops them all on the canvas (stacked top-to-bottom).

type Supplier = { key: string; label: string };
const SUPPLIERS: Supplier[] = [{ key: 'printful', label: 'Printful' }];

// Top-level "type of product" derived from the blank's gender bucket: men/women/kids → Apparel,
// accessories → Accessories. (Own-store suppliers will carry their own type later.)
type ProductType = 'apparel' | 'accessories';
const GENDERS: { key: BlankCategory; label: string }[] = [
  { key: 'men', label: 'Men' },
  { key: 'women', label: 'Women' },
  { key: 'kids', label: 'Kids' },
];
const POPULAR_COUNT = 8;

export function ProductPicker({
  visible,
  blanks,
  loading,
  error,
  onRetry,
  onClose,
  onAdd,
}: {
  visible: boolean;
  blanks: CatalogBlank[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  onClose: () => void;
  /** Confirmed selection — every chosen blank, dropped onto the canvas as a product. */
  onAdd: (blanks: CatalogBlank[]) => void;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const COLS = 2;
  const CARD = Math.round((width - Spacing.three * 2 - Spacing.three * (COLS - 1)) / COLS);

  // Drill state. supplier is fixed to the single supplier today; type/gender/category drive the levels.
  const [type, setType] = useState<ProductType | null>(null);
  const [gender, setGender] = useState<BlankCategory | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Record<string, CatalogBlank>>({});
  const searching = query.trim().length > 0;
  const selectedList = Object.values(selected);

  // The blanks in scope given the current type + gender (before the category drill-down).
  const scope = useMemo(() => {
    if (type === 'accessories') return blanks.filter((b) => b.category === 'accessories');
    if (type === 'apparel') {
      if (gender) return blanks.filter((b) => b.category === gender);
      return blanks.filter((b) => b.category !== 'accessories');
    }
    return blanks;
  }, [blanks, type, gender]);

  const typesAvailable = useMemo(() => {
    const out: { key: ProductType; label: string; image: string; count: number }[] = [];
    const apparel = blanks.filter((b) => b.category !== 'accessories');
    const accessories = blanks.filter((b) => b.category === 'accessories');
    if (apparel.length) out.push({ key: 'apparel', label: 'Apparel', image: apparel[0].image, count: apparel.length });
    if (accessories.length)
      out.push({ key: 'accessories', label: 'Accessories', image: accessories[0].image, count: accessories.length });
    return out;
  }, [blanks]);

  const gendersAvailable = useMemo(
    () =>
      GENDERS.map((g) => {
        const items = blanks.filter((b) => b.category === g.key);
        return { ...g, image: items[0]?.image, count: items.length };
      }).filter((g) => g.count > 0),
    [blanks],
  );

  // Product categories (the blank's `type`) within the current scope, each with a thumbnail + count.
  const categories = useMemo(() => {
    const m = new Map<string, { type: string; image: string; count: number }>();
    for (const b of scope) {
      const e = m.get(b.type);
      if (e) e.count++;
      else m.set(b.type, { type: b.type, image: b.image, count: 1 });
    }
    return [...m.values()].sort((a, b) => a.type.localeCompare(b.type));
  }, [scope]);

  const products = useMemo(
    () => (category ? scope.filter((b) => b.type === category) : []),
    [scope, category],
  );

  const matches = useMemo(() => {
    if (!searching) return [];
    const q = query.trim().toLowerCase();
    return blanks.filter((b) => b.name.toLowerCase().includes(q)).slice(0, 60);
  }, [blanks, query, searching]);

  // "Popular": a quick-pick rail of common items in the current scope, shown in front of the
  // subcategory tiles. (No popularity signal yet — a curated slice of the scope stands in.)
  const popular = useMemo(() => scope.slice(0, POPULAR_COUNT), [scope]);

  const toggle = (b: CatalogBlank) =>
    setSelected((prev) => {
      const next = { ...prev };
      if (next[b.id]) delete next[b.id];
      else next[b.id] = b;
      return next;
    });

  const reset = () => {
    setType(null);
    setGender(null);
    setCategory(null);
    setQuery('');
    setSelected({});
  };
  const confirm = () => {
    if (!selectedList.length) return;
    onAdd(selectedList);
    reset();
  };
  const close = () => {
    reset();
    onClose();
  };

  // One level up: search → browse, then product list → category → gender → type.
  const back = () => {
    if (searching) return setQuery('');
    if (category) return setCategory(null);
    if (gender) return setGender(null);
    if (type) return setType(null);
  };
  const atRoot = !type && !gender && !category && !searching;

  // What the body is showing right now (drives the Popular rail + the grid).
  const showProducts = searching || (type === 'accessories' ? !!category : !!category);
  const productList = searching ? matches : products;

  const card = (b: CatalogBlank) => {
    const on = !!selected[b.id];
    return (
      <Pressable key={b.id} onPress={() => toggle(b)} style={{ width: CARD }}>
        <ThemedView
          type="backgroundElement"
          style={[styles.card, { height: CARD }, on && { borderColor: theme.text, borderWidth: 2 }]}>
          <Image source={{ uri: b.image }} style={StyleSheet.absoluteFill} contentFit="contain" />
          <View style={styles.scrimSoft} pointerEvents="none" />
          <View style={styles.scrim} pointerEvents="none" />
          <View style={[styles.badge, on ? { backgroundColor: theme.text } : { backgroundColor: 'rgba(8,8,10,0.55)' }]}>
            <ThemedText type="smallBold" style={{ color: on ? theme.background : '#f4f4f6' }}>
              {on ? '✓' : '+'}
            </ThemedText>
          </View>
          <View style={styles.overlay} pointerEvents="none">
            <ThemedText type="smallBold" numberOfLines={2} style={styles.overlayLabel}>
              {b.name}
            </ThemedText>
          </View>
        </ThemedView>
      </Pressable>
    );
  };

  const tile = (label: string, sub: string, image: string | undefined, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} style={{ width: CARD }}>
      <ThemedView type="backgroundElement" style={[styles.card, { height: CARD }]}>
        {image ? <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="contain" /> : null}
        <View style={styles.scrimSoft} pointerEvents="none" />
        <View style={styles.scrim} pointerEvents="none" />
        <View style={styles.overlay} pointerEvents="none">
          <ThemedText type="smallBold" numberOfLines={1} style={styles.overlayLabel}>
            {label}
          </ThemedText>
          <ThemedText type="small" numberOfLines={1} style={styles.overlaySub}>
            {sub}
          </ThemedText>
        </View>
      </ThemedView>
    </Pressable>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <ThemedView style={styles.fill}>
        <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
          {/* Header: breadcrumb (Supplier › Type › Gender › Category) + close. */}
          <View style={styles.header}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.crumbs}>
              <Crumb label={SUPPLIERS[0].label} onPress={reset} active={atRoot} />
              {type ? <Crumb label={type === 'apparel' ? 'Apparel' : 'Accessories'} onPress={() => { setGender(null); setCategory(null); }} active={!gender && !category} /> : null}
              {gender ? <Crumb label={GENDERS.find((g) => g.key === gender)?.label ?? ''} onPress={() => setCategory(null)} active={!category} /> : null}
              {category ? <Crumb label={category} onPress={() => {}} active /> : null}
            </ScrollView>
            <Pressable onPress={close} hitSlop={10} style={styles.close}>
              <ThemedText type="small" themeColor="textSecondary">
                Close
              </ThemedText>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {loading && !blanks.length ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.status}>
                Loading products…
              </ThemedText>
            ) : !blanks.length ? (
              <View style={styles.status}>
                <ThemedText type="small" themeColor="textSecondary">
                  {error ? "Couldn't load products — check your connection." : 'No products available right now.'}
                </ThemedText>
                {onRetry ? <GlowButton label="Retry" variant="secondary" onPress={onRetry} style={styles.retry} /> : null}
              </View>
            ) : (
              <>
                {/* Popular rail — in front of the subcategories at every browse level. */}
                {!showProducts && popular.length ? (
                  <View style={styles.section}>
                    <ThemedText type="code" themeColor="textSecondary" style={styles.sectionLabel}>
                      ★ POPULAR
                    </ThemedText>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
                      {popular.map((b) => (
                        <View key={b.id} style={{ width: Math.round(CARD * 0.74) }}>
                          {(() => {
                            const on = !!selected[b.id];
                            return (
                              <Pressable onPress={() => toggle(b)}>
                                <ThemedView
                                  type="backgroundElement"
                                  style={[styles.card, { height: Math.round(CARD * 0.74) }, on && { borderColor: theme.text, borderWidth: 2 }]}>
                                  <Image source={{ uri: b.image }} style={StyleSheet.absoluteFill} contentFit="contain" />
                                  <View style={styles.scrim} pointerEvents="none" />
                                  <View style={[styles.badge, on ? { backgroundColor: theme.text } : { backgroundColor: 'rgba(8,8,10,0.55)' }]}>
                                    <ThemedText type="smallBold" style={{ color: on ? theme.background : '#f4f4f6' }}>
                                      {on ? '✓' : '+'}
                                    </ThemedText>
                                  </View>
                                  <View style={styles.overlay} pointerEvents="none">
                                    <ThemedText type="small" numberOfLines={1} style={styles.overlayLabel}>
                                      {b.name}
                                    </ThemedText>
                                  </View>
                                </ThemedView>
                              </Pressable>
                            );
                          })()}
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                ) : null}

                {/* The current browse level. */}
                <ThemedText type="code" themeColor="textSecondary" style={styles.sectionLabel}>
                  {searching
                    ? `${matches.length} RESULTS`
                    : showProducts
                      ? (category ?? '').toUpperCase()
                      : !type
                        ? 'TYPE OF PRODUCT'
                        : type === 'apparel' && !gender
                          ? 'WHO IS IT FOR'
                          : 'CATEGORY'}
                </ThemedText>
                <View style={styles.grid}>
                  {searching
                    ? productList.map(card)
                    : showProducts
                      ? productList.map(card)
                      : !type
                        ? typesAvailable.map((t) =>
                            tile(t.label, `${t.count} items`, t.image, () => {
                              setType(t.key);
                              if (t.key === 'accessories') setGender(null);
                            }),
                          )
                        : type === 'apparel' && !gender
                          ? gendersAvailable.map((g) => tile(g.label, `${g.count} items`, g.image, () => setGender(g.key)))
                          : categories.map((c) => tile(c.type, `${c.count} items`, c.image, () => setCategory(c.type)))}
                </View>
              </>
            )}
          </ScrollView>

          {/* Bottom controls — search + back/add. (Controls live at the bottom of the picker.) */}
          <View style={[styles.controls, { borderTopColor: theme.backgroundElement }]}>
            <GlowInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search all products…"
              autoCapitalize="none"
              containerStyle={styles.search}
            />
            <View style={styles.controlRow}>
              {!atRoot ? <GlowButton label="‹ Back" variant="ghost" onPress={back} /> : null}
              <GlowButton
                label={selectedList.length ? `Add ${selectedList.length} product${selectedList.length > 1 ? 's' : ''}` : 'Select products'}
                onPress={confirm}
                disabled={!selectedList.length}
                style={styles.add}
              />
            </View>
          </View>
        </SafeAreaView>
      </ThemedView>
    </Modal>
  );
}

function Crumb({ label, onPress, active }: { label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable onPress={onPress} style={styles.crumb} hitSlop={4}>
      <ThemedText type="small" themeColor={active ? 'text' : 'textSecondary'} numberOfLines={1}>
        {label}
      </ThemedText>
      {!active ? (
        <ThemedText type="small" themeColor="textSecondary">
          {'  ›'}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  crumbs: { alignItems: 'center', gap: Spacing.one, paddingRight: Spacing.two },
  crumb: { flexDirection: 'row', alignItems: 'center' },
  close: { paddingLeft: Spacing.two },
  body: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four, gap: Spacing.two },
  status: { paddingVertical: Spacing.four, gap: Spacing.three, alignItems: 'flex-start' },
  retry: { alignSelf: 'flex-start' },
  section: { gap: Spacing.two },
  sectionLabel: { textTransform: 'uppercase', marginTop: Spacing.two },
  rail: { gap: Spacing.three, paddingVertical: Spacing.one },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  card: { borderRadius: Spacing.four, overflow: 'hidden' },
  scrimSoft: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '50%', backgroundColor: 'rgba(8,8,10,0.22)' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '38%', backgroundColor: 'rgba(8,8,10,0.62)' },
  badge: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.one,
  },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
  overlayLabel: { color: '#f4f4f6' },
  overlaySub: { color: 'rgba(235,237,241,0.7)' },
  controls: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: Spacing.three, paddingTop: Spacing.three, gap: Spacing.three },
  search: { marginBottom: 0 },
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  add: { flex: 1 },
});
