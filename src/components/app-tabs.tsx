import { TabList, TabSlot, TabTrigger, type TabTriggerSlotProps, Tabs } from 'expo-router/ui';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabBarBlur } from '@/components/tab-bar-blur';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Nano Crew tab bar — a JS (expo-router/ui) bar drawn to MIMIC the native iOS UITabBar: opaque,
// mode-aware background; thin outline glyphs; platinum-silver selected tint with the rest dimmed.
// It's built from RN Views (not expo-router/unstable-native-tabs) to drop a dependency on an unstable
// API. ONE file serves both platforms (the blur is platform-split in tab-bar-blur — native expo-blur,
// web CSS backdrop-filter).

type TabDef = {
  name: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: '/studio' | '/design' | '/market' | '/account';
};

// The social feed (route /feed) is HIDDEN for v1 — it returns as a tab in v2. Studio leads (the home).
const TABS: TabDef[] = [
  { name: 'studio', label: 'Studio', icon: 'sparkles-outline', href: '/studio' },
  { name: 'design', label: 'Design', icon: 'brush-outline', href: '/design' },
  { name: 'market', label: 'Market', icon: 'bag-outline', href: '/market' },
  { name: 'account', label: 'Account', icon: 'person-circle-outline', href: '/account' },
];

export default function AppTabs() {
  const dark = useColorScheme() !== 'light';
  const c = dark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  return (
    <Tabs>
      {/* The active screen fills the space; the bar floats over the bottom (screens pad BottomTabInset). */}
      <TabSlot style={styles.slot} />
      <TabList asChild>
        {/* asChild clones this into the tab-list element; on web a STYLE ARRAY here reaches a raw
            <div> unflattened and crashes react-dom — pass a single flattened object. */}
        <View
          style={StyleSheet.flatten([
            styles.bar,
            { borderTopColor: c.backgroundSelected, paddingBottom: insets.bottom + Spacing.four },
          ])}>
          {/* Frosted-glass blur behind the bar — the native translucent iOS bar look (web uses backdrop-filter). */}
          <TabBarBlur dark={dark} />
          {TABS.map((t) => (
            <TabTrigger key={t.name} name={t.name} href={t.href} asChild>
              <TabButton tab={t} tint={c.tint} />
            </TabTrigger>
          ))}
        </View>
      </TabList>
    </Tabs>
  );
}

// Receives the trigger slot props (isFocused, onPress, …) via TabTrigger asChild. The Pressable is the
// trigger; the inner View holds the icon+label cluster.
function TabButton({ tab, tint, isFocused, style: triggerStyle, ...props }: TabTriggerSlotProps & { tab: TabDef; tint: string }) {
  return (
    // Flatten the (Radix-merged) trigger style + ours into ONE object: the raw Slot in TabTrigger
    // spreads style by object, so an array here becomes {0:..,1:..} and crashes react-dom on web.
    <Pressable {...props} style={StyleSheet.flatten([triggerStyle, styles.tab])}>
      <View style={[styles.tabInner, { opacity: isFocused ? 1 : 0.5 }]}>
        <Ionicons name={tab.icon} size={26} color={tint} />
        {/* Tab labels are intentionally 11pt to match the native UITabBar labelStyle (no token is that small). */}
        <ThemedText type="small" style={[styles.label, { color: tint }]}>
          {tab.label}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  slot: { flex: 1 },
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
    paddingHorizontal: Spacing.three, // keep edge labels (Account) off the screen edge
    overflow: 'hidden', // clip the BlurView to the bar
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabInner: { alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { fontSize: 11, lineHeight: 13 },
});
