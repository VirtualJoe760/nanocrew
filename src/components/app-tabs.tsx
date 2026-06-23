import { Icon, Label, NativeTabs, VectorIcon } from 'expo-router/unstable-native-tabs';
import { MaterialIcons } from '@expo/vector-icons';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

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
      {/* Icons: `sf` (SF Symbols) is iOS-ONLY — it renders nothing on Android, which left the tab
          bar empty/black there (only the selected tab's label pill showed). `androidSrc` supplies the
          Android equivalent (a @expo/vector-icons glyph), so both platforms show icons. Keep them
          visually matched. */}
      <NativeTabs.Trigger name="studio">
        <Icon sf="wand.and.stars" androidSrc={<VectorIcon family={MaterialIcons} name="auto-awesome" />} />
        <Label>Studio</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="design">
        <Icon sf="paintbrush.pointed" androidSrc={<VectorIcon family={MaterialIcons} name="brush" />} />
        <Label>Design</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="market">
        <Icon sf="bag" androidSrc={<VectorIcon family={MaterialIcons} name="shopping-bag" />} />
        <Label>Market</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="account">
        <Icon sf="person.circle" androidSrc={<VectorIcon family={MaterialIcons} name="account-circle" />} />
        <Label>Account</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
