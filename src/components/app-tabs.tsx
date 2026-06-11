import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';

// SDK 54 native-tabs API: Icon and Label are separate children of each Trigger.
export default function AppTabs() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf="sparkles" />
        <Label>Nanocrew</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="market">
        <Icon sf="bag.fill" />
        <Label>Market</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="studio">
        <Icon sf="wand.and.stars" />
        <Label>Studio</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="design">
        <Icon sf="paintpalette.fill" />
        <Label>Design</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="account">
        <Icon sf="person.crop.circle.fill" />
        <Label>Account</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
