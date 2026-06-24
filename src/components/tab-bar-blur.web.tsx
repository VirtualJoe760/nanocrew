import { StyleSheet, View } from 'react-native';

// Web frosted layer: CSS backdrop-filter on a plain react-native-web View (which flattens its style),
// instead of expo-blur's web BlurView, which passes a style ARRAY to a raw <div> and crashes react-dom.
export function TabBarBlur({ dark }: { dark: boolean }) {
  const webStyle = {
    backgroundColor: dark ? 'rgba(8,8,10,0.6)' : 'rgba(245,245,246,0.7)',
    backdropFilter: 'blur(18px)',
    WebkitBackdropFilter: 'blur(18px)',
  } as const;
  return <View style={[StyleSheet.absoluteFill, webStyle as object]} />;
}
