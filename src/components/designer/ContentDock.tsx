import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { DOCK_TAB_CLEARANCE } from '@/components/designer/TemplatesDock';

/**
 * Content panel (stub) — the future home for video: scene clips and the workflows you push them
 * through (and a motion hero for the site). Wired for real in the video phase.
 */
export function ContentDock() {
  return (
    <View style={styles.dock}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.text}>
        Video lands here soon — make scene clips and run them through your workflows, then push them
        to a product or your site’s motion hero.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { paddingTop: Spacing.two, paddingBottom: DOCK_TAB_CLEARANCE },
  text: { paddingHorizontal: Spacing.three, lineHeight: 18 },
});
