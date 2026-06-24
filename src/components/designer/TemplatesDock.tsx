import { useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';
import type { BlankCategory, CatalogBlank } from '@/lib/printful';

const GENDERS: { key: BlankCategory; label: string }[] = [
  { key: 'men', label: 'Men' },
  { key: 'women', label: 'Women' },
  { key: 'kids', label: 'Kids' },
  { key: 'accessories', label: 'Access.' },
];

// The JS tab bar sits BELOW the screen (no overlay), so the dock no longer needs to clear it — just a
// small gap. (Was 84 for the old NativeTabs overlay; that's now dead space below the cards/handle.)
export const DOCK_TAB_CLEARANCE = Spacing.two;

export function TemplatesDock({
  blanks,
  loading,
  error,
  onRetry,
  onAdd,
}: {
  blanks: CatalogBlank[];
  loading: boolean;
  /** The catalogue failed to load (network / Printful). Show a retry instead of an empty dock. */
  error?: boolean;
  onRetry?: () => void;
  onAdd: (b: CatalogBlank) => void;
}) {
  const theme = useTheme();
  // Big swipeable cards: ~1.5 fit per panel (the next one peeks → invites the swipe), capped on wide/web.
  const { width } = useWindowDimensions();
  const CARD = Math.min(Math.round(width * 0.64), 300);
  const [gender, setGender] = useState<BlankCategory>('men');
  const [type, setType] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;

  const inGender = useMemo(() => blanks.filter((b) => b.category === gender), [blanks, gender]);

  // Search filters by product name across the whole gender bucket (skips the type drill-down).
  const matches = useMemo(() => {
    if (!searching) return [];
    const q = query.trim().toLowerCase();
    return inGender.filter((b) => b.name.toLowerCase().includes(q)).slice(0, 60);
  }, [inGender, query, searching]);

  // Product types within the chosen gender (each with a representative thumbnail).
  const types = useMemo(() => {
    const m = new Map<string, { type: string; image: string; count: number }>();
    for (const b of inGender) {
      const e = m.get(b.type);
      if (e) e.count++;
      else m.set(b.type, { type: b.type, image: b.image, count: 1 });
    }
    return [...m.values()].sort((a, b) => a.type.localeCompare(b.type));
  }, [inGender]);

  const products = useMemo(
    () => (type ? inGender.filter((b) => b.type === type) : []),
    [inGender, type],
  );

  return (
    <View style={styles.dock}>
      <View style={styles.filterRow}>
        {GENDERS.map((g) => {
          const active = gender === g.key;
          return (
            <Pressable
              key={g.key}
              onPress={() => {
                setGender(g.key);
                setType(null);
              }}>
              <ThemedView
                type={active ? 'backgroundSelected' : 'backgroundElement'}
                style={styles.tab}>
                <ThemedText type="small" themeColor={active ? 'text' : 'textSecondary'}>
                  {g.label}
                </ThemedText>
              </ThemedView>
            </Pressable>
          );
        })}
        {type ? (
          <Pressable onPress={() => setType(null)} style={styles.back}>
            <ThemedText type="small" themeColor="textSecondary">
              ‹ {type}
            </ThemedText>
          </Pressable>
        ) : null}
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search products…"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
      </View>

      {loading && !blanks.length ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.status}>
          Loading catalogue…
        </ThemedText>
      ) : !blanks.length ? (
        // Loaded but empty → either a load failure (show Retry) or, rarely, a genuinely empty result.
        <View style={[styles.status, styles.emptyState]}>
          <ThemedText type="small" themeColor="textSecondary">
            {error ? "Couldn't load products — check your connection." : 'No products available right now.'}
          </ThemedText>
          {onRetry ? (
            <Pressable onPress={onRetry}>
              <ThemedView type="backgroundSelected" style={styles.retryBtn}>
                <ThemedText type="small" themeColor="text">
                  Retry
                </ThemedText>
              </ThemedView>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
          // Pull the row to the right past its start → back to the categories.
          onScrollEndDrag={(e) => {
            if (type && e.nativeEvent.contentOffset.x < -48) setType(null);
          }}
          scrollEventThrottle={16}>
          {type && !searching ? (
            <Pressable onPress={() => setType(null)}>
              <ThemedView type="backgroundElement" style={[styles.card, styles.backCard, { width: Math.round(CARD * 0.62), height: CARD }]}>
                <ThemedText type="title" themeColor="textSecondary">
                  ‹
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  All {GENDERS.find((g) => g.key === gender)?.label}
                </ThemedText>
              </ThemedView>
            </Pressable>
          ) : null}
          {searching || type
            ? (searching ? matches : products).map((b) => (
                <Pressable key={b.id} onPress={() => onAdd(b)}>
                  <ThemedView type="backgroundElement" style={[styles.card, { width: CARD, height: CARD }]}>
                    <Image source={{ uri: b.image }} style={StyleSheet.absoluteFill} contentFit="contain" />
                    <View style={styles.scrimSoft} pointerEvents="none" />
                    <View style={styles.scrim} pointerEvents="none" />
                    <View style={styles.overlay} pointerEvents="none">
                      <ThemedText type="smallBold" numberOfLines={1} style={styles.overlayLabel}>
                        {b.name}
                      </ThemedText>
                    </View>
                  </ThemedView>
                </Pressable>
              ))
            : types.map((t) => (
                <Pressable key={t.type} onPress={() => setType(t.type)}>
                  <ThemedView type="backgroundElement" style={[styles.card, { width: CARD, height: CARD }]}>
                    <Image source={{ uri: t.image }} style={StyleSheet.absoluteFill} contentFit="contain" />
                    <View style={styles.scrimSoft} pointerEvents="none" />
                    <View style={styles.scrim} pointerEvents="none" />
                    <View style={styles.overlay} pointerEvents="none">
                      <ThemedText type="smallBold" numberOfLines={1} style={styles.overlayLabel}>
                        {t.type}
                      </ThemedText>
                      <ThemedText type="small" numberOfLines={1} style={styles.overlaySub}>
                        {t.count} items
                      </ThemedText>
                    </View>
                  </ThemedView>
                </Pressable>
              ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { paddingTop: Spacing.two, paddingBottom: DOCK_TAB_CLEARANCE, gap: Spacing.two },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
  },
  tab: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.three, borderRadius: 999 },
  back: { marginLeft: Spacing.two },
  search: {
    flex: 1,
    minWidth: 90,
    marginLeft: Spacing.two,
    height: 30,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    fontSize: 13,
  },
  status: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.three },
  emptyState: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  retryBtn: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.three, borderRadius: 999 },
  row: { gap: Spacing.three, paddingHorizontal: Spacing.three, alignItems: 'flex-end' },
  // Big square cards (size set inline, responsive): the product image fills the card and the name is
  // OVERLAID at the bottom over a soft scrim, so every card is the SAME size (no variable-height labels).
  card: { borderRadius: Spacing.four, overflow: 'hidden' },
  backCard: { alignItems: 'center', justifyContent: 'center', gap: Spacing.one, padding: Spacing.three },
  // Two stacked bands fake a gradient (transparent → dark) under the label — no gradient lib needed.
  scrimSoft: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '50%', backgroundColor: 'rgba(8,8,10,0.22)' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '30%', backgroundColor: 'rgba(8,8,10,0.62)' },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
  overlayLabel: { color: '#f4f4f6' },
  overlaySub: { color: 'rgba(235,237,241,0.7)' },
});
