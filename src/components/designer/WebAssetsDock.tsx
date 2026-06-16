import { useState } from 'react';
import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { DesignTile } from '@/components/design-tile';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { DOCK_TAB_CLEARANCE } from '@/components/designer/TemplatesDock';

export type WebSlot = 'hero' | 'logo' | 'cover';

// The website spots that can hold a creator-generated graphic. These map 1:1 to the
// /api/creator/site-assets slots; assigning overrides the template's content/placeholders.json.
// (Hero video lives under the Content panel; section slots come later.)
const SLOTS: { slot: WebSlot; label: string; hint: string }[] = [
  { slot: 'hero', label: 'Website hero', hint: 'The big image at the top of your site' },
  { slot: 'logo', label: 'Logo', hint: 'Your brand mark (header + footer)' },
  { slot: 'cover', label: 'Collection cover', hint: 'The cover for the current collection' },
];

type DesignLite = { id: string; prompt: string; color: string; image?: string };

/**
 * Web assets panel — pick a website slot, then pick one of your generated graphics to put there.
 * Mirrors the Products panel ("pull up a target, attach the generation"), but the targets are the
 * site's own slots rather than apparel. The actual write/override is handled by onAssign.
 */
export function WebAssetsDock({
  designs,
  onAssign,
}: {
  designs: DesignLite[];
  onAssign: (url: string, slot: WebSlot) => void;
}) {
  const [picking, setPicking] = useState<WebSlot | null>(null);
  // Only hosted graphics can be assigned to the site.
  const usable = designs.filter((d) => typeof d.image === 'string' && d.image.startsWith('http'));

  return (
    <View style={styles.dock}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {SLOTS.map((s) => {
          const active = picking === s.slot;
          return (
            <Pressable key={s.slot} onPress={() => setPicking(active ? null : s.slot)}>
              <ThemedView type={active ? 'backgroundSelected' : 'backgroundElement'} style={styles.card}>
                <ThemedText type="small" themeColor={active ? 'text' : 'textSecondary'} numberOfLines={1}>
                  {s.label}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} style={styles.hint}>
                  {s.hint}
                </ThemedText>
              </ThemedView>
            </Pressable>
          );
        })}
      </ScrollView>

      {picking ? (
        usable.length ? (
          <>
            <ThemedText type="small" themeColor="textSecondary" style={styles.pickLabel}>
              Tap a graphic to use as {SLOTS.find((s) => s.slot === picking)?.label.toLowerCase()}:
            </ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {usable.map((d) => (
                <Pressable
                  key={d.id}
                  onPress={() => {
                    onAssign(d.image as string, picking);
                    setPicking(null);
                  }}>
                  <ThemedView type="backgroundElement" style={styles.thumbCard}>
                    {d.image ? (
                      <Image source={{ uri: d.image }} style={styles.thumb} contentFit="cover" />
                    ) : (
                      <DesignTile color={d.color} style={styles.thumb} />
                    )}
                  </ThemedView>
                </Pressable>
              ))}
            </ScrollView>
          </>
        ) : (
          <ThemedText type="small" themeColor="textSecondary" style={styles.pickLabel}>
            Generate a graphic first (the Graphics tab), then come back to place it here.
          </ThemedText>
        )
      ) : (
        <ThemedText type="small" themeColor="textSecondary" style={styles.pickLabel}>
          Pick a spot on your site, then choose a graphic to put there.
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { paddingTop: Spacing.two, paddingBottom: DOCK_TAB_CLEARANCE, gap: Spacing.two },
  row: { gap: Spacing.two, paddingHorizontal: Spacing.three },
  card: { width: 150, padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.one },
  hint: { lineHeight: 15 },
  pickLabel: { paddingHorizontal: Spacing.three },
  thumbCard: { padding: Spacing.one, borderRadius: Spacing.three },
  thumb: { width: 72, height: 72, borderRadius: Spacing.two },
});
