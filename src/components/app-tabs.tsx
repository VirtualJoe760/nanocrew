import { TabList, TabSlot, TabTrigger, type TabTriggerSlotProps, Tabs } from 'expo-router/ui';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';

import { TabBarBlur } from '@/components/tab-bar-blur';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { summonEve } from '@/lib/eve-bus';

// Nano Crew tab bar — a JS (expo-router/ui) bar drawn to MIMIC the native iOS UITabBar: opaque,
// mode-aware background; thin outline glyphs; platinum-silver selected tint with the rest dimmed.
// It's built from RN Views (not expo-router/unstable-native-tabs) to drop a dependency on an unstable
// API. ONE file serves both platforms (the blur is platform-split in tab-bar-blur — native expo-blur,
// web CSS backdrop-filter).
//
// MIGRATION toward Eve-driven nav (docs/studio/EVE_CONTROL.md): the tabs are the browsable "noun"
// layer; EVE, front-and-center, is the "verb" layer — the thumb-reachable way to act/navigate by
// voice or her orb tree (the top-edge pull-down is barely reachable on a phone). As her nav matures
// the flanking tabs thin down; for now both coexist.

type TabDef = {
  name: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: '/studio' | '/design' | '/market' | '/account';
};

// The social feed (route /feed) is HIDDEN for v1 — it returns as a tab in v2. Studio leads (the home).
// Split into left/right of the centred Eve summon.
const LEFT_TABS: TabDef[] = [
  { name: 'studio', label: 'Studio', icon: 'sparkles-outline', href: '/studio' },
  { name: 'design', label: 'Design', icon: 'brush-outline', href: '/design' },
];
const RIGHT_TABS: TabDef[] = [
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
          {LEFT_TABS.map((t) => (
            <TabTrigger key={t.name} name={t.name} href={t.href} asChild>
              <TabButton tab={t} tint={c.tint} />
            </TabTrigger>
          ))}
          <EveSummon />
          {RIGHT_TABS.map((t) => (
            <TabTrigger key={t.name} name={t.name} href={t.href} asChild>
              <TabButton tab={t} tint={c.tint} />
            </TabTrigger>
          ))}
        </View>
      </TabList>
    </Tabs>
  );
}

// EVE — the centred summon. Not a route (it opens the overlay), so it's a plain Pressable, not a
// TabTrigger. A glowing teal orb (her constellation colour) lifted slightly above the tab row.
function EveSummon() {
  return (
    <Pressable
      onPress={() => summonEve({ state: 'home' })}
      accessibilityRole="button"
      accessibilityLabel="Eve"
      hitSlop={8}
      style={styles.eveTab}>
      <View style={styles.eveOrb}>
        <Svg width={46} height={46} viewBox="0 0 46 46">
          <Defs>
            <RadialGradient id="eve-tab-glow" cx="50%" cy="45%" r="55%">
              <Stop offset="0%" stopColor="#7fd7e6" stopOpacity={0.7} />
              <Stop offset="60%" stopColor="#7fd7e6" stopOpacity={0.18} />
              <Stop offset="100%" stopColor="#7fd7e6" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={23} cy={23} r={22} fill="url(#eve-tab-glow)" />
          <Circle cx={23} cy={23} r={15} fill="rgba(7,11,17,0.6)" stroke="#7fd7e6" strokeOpacity={0.6} strokeWidth={1} />
          <Path
            d="M23 13.5 L24.4 20.6 L31.5 22 L24.4 23.4 L23 30.5 L21.6 23.4 L14.5 22 L21.6 20.6 Z"
            fill="none"
            stroke="#e6f7fb"
            strokeWidth={1.4}
            strokeLinejoin="round"
          />
        </Svg>
      </View>
      <ThemedText type="small" style={[styles.label, { color: '#9fdfe9' }]}>
        Eve
      </ThemedText>
    </Pressable>
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
  eveTab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  eveOrb: { marginTop: -10, width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
});
