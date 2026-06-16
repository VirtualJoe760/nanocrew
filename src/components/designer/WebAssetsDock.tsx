import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { DOCK_TAB_CLEARANCE } from '@/components/designer/TemplatesDock';

export type WebSlot = 'hero' | 'logo' | 'cover';

// The website spots that can hold a creator-generated graphic. These map 1:1 to the
// /api/creator/site-assets slots; connecting a design to one overrides the template placeholder.
// (Hero video lives under Content; section slots come later.)
const SLOTS: { slot: WebSlot; label: string; hint: string }[] = [
  { slot: 'hero', label: 'Website hero', hint: 'The big image at the top of your site' },
  { slot: 'logo', label: 'Logo', hint: 'Your brand mark (header + footer)' },
  { slot: 'cover', label: 'Collection cover', hint: 'The cover for the current collection' },
];

/**
 * Web assets panel — tap a slot to drop a labeled target onto the canvas, then connect a graphic
 * to it (drag a design onto the target) to assign it. Mirrors how Products work: pull up a target,
 * attach the generation. The connect + write is handled on the canvas (onAddSlot adds the node).
 */
export function WebAssetsDock({ onAddSlot }: { onAddSlot: (slot: WebSlot) => void }) {
  return (
    <View style={styles.dock}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {SLOTS.map((s) => (
          <Pressable key={s.slot} onPress={() => onAddSlot(s.slot)}>
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="small" numberOfLines={1}>
                {s.label}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} style={styles.hint}>
                {s.hint}
              </ThemedText>
            </ThemedView>
          </Pressable>
        ))}
      </ScrollView>
      <ThemedText type="small" themeColor="textSecondary" style={styles.pickLabel}>
        Tap a spot to drop it on the canvas, then connect a graphic to it.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { paddingTop: Spacing.two, paddingBottom: DOCK_TAB_CLEARANCE, gap: Spacing.two },
  row: { gap: Spacing.two, paddingHorizontal: Spacing.three },
  card: { width: 150, padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.one },
  hint: { lineHeight: 15 },
  pickLabel: { paddingHorizontal: Spacing.three },
});
