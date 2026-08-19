import { TabList, TabSlot, TabTrigger, type TabTriggerSlotProps, Tabs } from 'expo-router/ui';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabBarBlur } from '@/components/tab-bar-blur';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Nano Crew tab bar — a JS (expo-router/ui) bar drawn to MIMIC the native iOS UITabBar:
// TRANSLUCENT frosted glass FLOATING over the content (Joe, 2026-08-18 — the old in-flow bar had
// nothing behind it, so its blur read as opaque); thin outline glyphs; platinum-silver selected
// tint with the rest dimmed. Screens clear it via BottomTabInset (constants/theme).
//
// THE PIVOT (docs/studio/EVE_CONTROL.md): Eve is the living background of the whole app, and these
// four tabs are how you navigate her — each a different facet you zoom to. EVE leads (the merged
// Studio: brand management, the interview, the digest). The Design/Market/Account pages overlay
// their components on the same persistent Eve behind them.

type TabDef = {
  name: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: '/studio' | '/design' | '/market' | '/account';
};

// `studio` route is now the EVE page (Studio merges into it). /feed stays hidden for v1.
/** The bar's own content height — icon (24) + label (~13) + its 6pt top padding — ABOVE the
 *  home-indicator inset it sits on. The bar is absolutely positioned, so a full-screen surface that
 *  draws underneath it (Eve's site editor) must reserve this plus the inset, or its bottom controls
 *  are cut in half (Joe, 2026-08-19: "the eve icon is being cut off by the mobile bottom bar"). */
export const TAB_BAR_CONTENT_HEIGHT = 43;

/** How much room a surface under the tab bar must leave at the bottom. */
export function tabBarSpace(bottomInset: number): number {
  return TAB_BAR_CONTENT_HEIGHT + Math.max(bottomInset - 6, 6);
}

const TABS: TabDef[] = [
  { name: 'studio', label: 'Eve', icon: 'sparkles-outline', href: '/studio' },
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
      {/* Flex column: the active screen fills the space, the bar sits BELOW it (in-flow, not
          floating — it's a plain View, not a native UITabBar). Screens reserve nothing for it. */}
      <TabSlot style={styles.slot} />
      <TabList asChild>
        {/* asChild clones this into the tab-list element; on web a STYLE ARRAY here reaches a raw
            <div> unflattened and crashes react-dom — pass a single flattened object. */}
        <View
          style={StyleSheet.flatten([
            styles.bar,
            // Native UITabBar metrics: a tight icon+label cluster sitting ON the home-indicator
            // inset — labels tuck a few points INTO it, like UIKit's. The slight tint over the
            // blur is what makes it read as glass instead of a smear.
            {
              borderTopColor: c.backgroundSelected,
              paddingBottom: Math.max(insets.bottom - 6, 6),
              backgroundColor: dark ? 'rgba(9,11,15,0.58)' : 'rgba(250,250,252,0.6)',
            },
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
        <Ionicons name={tab.icon} size={24} color={tint} />
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
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6, // native UITabBar: icon sits ~6pt under the hairline
    paddingHorizontal: Spacing.three, // keep edge labels (Account) off the screen edge
    overflow: 'hidden', // clip the BlurView to the bar
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabInner: { alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { fontSize: 11, lineHeight: 13 },
});
