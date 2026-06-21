import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { AppBackground } from '@/components/backgrounds/app-background';
import { attachReviewDeepLink } from '@/lib/push';

// Hold the native splash until General Sans (the brand sans) is loaded, so text never
// flashes in the system font first.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function TabLayout() {
  const [fontsLoaded] = useFonts({
    // Jost (OFL) — static instances generated from the variable font. Each weight is its own
    // family because RN can't derive a custom font's weight from `fontWeight`. Body = Light 300;
    // the "Nano Crew" wordmark = Thin 100. (Mapping lives in components/themed-text.tsx.)
    'Jost-Thin': require('../../assets/fonts/Jost-Thin.ttf'),
    'Jost-Light': require('../../assets/fonts/Jost-Light.ttf'),
    'Jost-Regular': require('../../assets/fonts/Jost-Regular.ttf'),
    'Jost-Medium': require('../../assets/fonts/Jost-Medium.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  // Route a tapped "changes ready" push to the store's Edit/review.
  useEffect(() => attachReviewDeepLink(), []);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* One continuous background for the whole app, behind the tabs. Studio/Market/Account
          render transparent so it shows through; Design keeps an opaque backdrop (no dots). */}
      <AppBackground />
      <AnimatedSplashOverlay />
      <AppTabs />
    </GestureHandlerRootView>
  );
}
