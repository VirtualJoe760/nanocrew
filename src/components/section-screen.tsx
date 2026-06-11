import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';

type Props = {
  /** Small uppercase label above the title. */
  eyebrow: string;
  title: string;
  description: string;
  /** What this section will do — shown as a checklist while it's still scaffolding. */
  points: string[];
};

/**
 * Placeholder screen for a not-yet-built app section. Keeps every tab looking
 * intentional while the real features land. Replace per-section as we build.
 */
export function SectionScreen({ eyebrow, title, description, points }: Props) {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.header}>
          <ThemedText type="code" style={styles.eyebrow}>
            {eyebrow}
          </ThemedText>
          <ThemedText type="title" style={styles.title}>
            {title}
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.description}>
            {description}
          </ThemedText>
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.card}>
          {points.map((point) => (
            <ThemedText key={point} type="small" themeColor="textSecondary">
              ◦  {point}
            </ThemedText>
          ))}
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.four,
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.four,
    maxWidth: MaxContentWidth,
  },
  header: {
    gap: Spacing.two,
  },
  eyebrow: {
    textTransform: 'uppercase',
  },
  title: {},
  description: {
    fontSize: 16,
    lineHeight: 22,
  },
  card: {
    gap: Spacing.two,
    alignSelf: 'stretch',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
    borderRadius: Spacing.four,
  },
});
