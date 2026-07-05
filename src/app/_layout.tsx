import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import VenusSheet from '@/components/venus-sheet';
import { attachReviewDeepLink } from '@/lib/push';

// The VENUS LAB — our tool for iterating on Venus's APPEARANCE — now opens as a gated full-screen
// test tool from the Account screen (see src/components/venus-lab-screen.tsx), not from here. Full
// guide + workflow in docs/studio/VENUS_AVATAR.md ("The Venus Lab").

// Hold the native splash until General Sans (the brand sans) is loaded, so text never
// flashes in the system font first.
SplashScreen.preventAutoHideAsync().catch(() => {});

// Paint the native root view brand-dark so tab transitions never flash white (the iOS root/scene
// background defaults to white; the RN content can't cover the instant a screen swaps in).
SystemUI.setBackgroundColorAsync('#08080a').catch(() => {});

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
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#08080a' }}>
      {/* The dot-field background is rendered INSIDE each tab screen (studio/market/account),
          not here — each screen owns its own background (see withScreenFade). */}
      {/* The dot-field background is rendered INSIDE each tab screen (studio/market/account), not
          here — each screen owns its own background (see withScreenFade). */}
      <AnimatedSplashOverlay />
      <AppTabs />
      {/* VENUS'S STEADY STATE — slide down from the top edge to activate her, up to pause
          (docs/studio/VENUS_CENTRAL.md). Mounted once, above the tabs. */}
      <VenusSheet />
    </GestureHandlerRootView>
  );
}
