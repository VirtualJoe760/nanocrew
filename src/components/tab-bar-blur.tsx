import { BlurView } from 'expo-blur';
import { StyleSheet } from 'react-native';

// The frosted layer behind the tab bar. NATIVE: a real expo-blur BlurView. Web has its own variant
// (tab-bar-blur.web.tsx) because expo-blur's web BlurView passes a style ARRAY to a raw <div>, which
// react-dom rejects ("indexed property [0]") — web uses CSS backdrop-filter instead.
export function TabBarBlur({ dark }: { dark: boolean }) {
  return <BlurView intensity={64} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />;
}
