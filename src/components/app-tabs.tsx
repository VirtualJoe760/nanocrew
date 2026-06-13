import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';

// Nano Crew tab bar: champagne-gold selected tint + thin, elegant outline glyphs (no heavy
// `.fill` weights), so the chrome reads premium and on-brand. The nucleus motif marks the
// feed. Icon and Label are separate children of each Trigger (SDK 54 native-tabs API).
const GOLD = '#c9a86a';

export default function AppTabs() {
  return (
    <NativeTabs tintColor={GOLD} labelStyle={{ fontSize: 11 }}>
      <NativeTabs.Trigger name="index">
        <Icon sf="circle.hexagongrid" />
        <Label>Nanocrew</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="market">
        <Icon sf="bag" />
        <Label>Market</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="studio">
        <Icon sf="wand.and.stars" />
        <Label>Studio</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="design">
        <Icon sf="paintbrush.pointed" />
        <Label>Design</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="account">
        <Icon sf="person.circle" />
        <Label>Account</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
