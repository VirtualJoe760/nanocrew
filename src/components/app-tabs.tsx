import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

// Nano Crew tab bar: platinum-silver selected tint + thin, elegant outline glyphs (no heavy
// `.fill` weights), so the chrome reads premium and on-brand. Background is OPAQUE (mode-aware) so
// the menu stays legible over full-bleed feed media of any brightness — it never bleeds through.
// Icon and Label are separate children of each Trigger (SDK 54 native-tabs API).

export default function AppTabs() {
  const dark = useColorScheme() !== 'light';
  const c = dark ? Colors.dark : Colors.light;
  return (
    <NativeTabs
      tintColor={c.tint}
      backgroundColor={c.background}
      // The full-screen feed is always at a "scroll edge", where iOS would make the bar transparent
      // and the menu vanish over bright media — force the opaque appearance instead.
      disableTransparentOnScrollEdge
      labelStyle={{ fontSize: 11 }}
    >
      {/* The social feed (route /feed) is HIDDEN for v1; it returns as a tab in v2. Studio leads
          (the app's home — build your brand site), then Design, then Market. */}
      <NativeTabs.Trigger name="studio">
        <Icon sf="wand.and.stars" />
        <Label>Studio</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="design">
        <Icon sf="paintbrush.pointed" />
        <Label>Design</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="market">
        <Icon sf="bag" />
        <Label>Market</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="account">
        <Icon sf="person.circle" />
        <Label>Account</Label>
      </NativeTabs.Trigger>

      {/* Dev-only GPU/shader sandbox — a "Lab" tab in dev builds only (absent in production; the
          screen also returns null there). Renders on a native dev build; the web preview can't show
          it because expo-router/unstable-native-tabs only renders the initial tab on web. */}
      {__DEV__ ? (
        <NativeTabs.Trigger name="playground">
          <Icon sf="cube" />
          <Label>Lab</Label>
        </NativeTabs.Trigger>
      ) : null}
    </NativeTabs>
  );
}
