import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { AppBackground } from '@/components/backgrounds/app-background';
import Playground from './playground'; // the VENUS LAB (see VENUS_LAB below)
import { attachReviewDeepLink } from '@/lib/push';

// ── THE VENUS LAB ────────────────────────────────────────────────────────────
// Our dedicated, permanent playground for iterating on Venus's APPEARANCE. Flip the
// `false` to `true` to enter it (renders the live venus-head-scene full-screen instead
// of the app); flip back to `false` for the normal app. Gated by `__DEV__` so it can
// NEVER ship to production. This is where we work on Venus — full guide + workflow in
// docs/studio/VENUS_AVATAR.md ("The Venus Lab").
const VENUS_LAB = __DEV__ && false;

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
      {VENUS_LAB ? (
        <Playground />
      ) : (
        <>
          <AppBackground />
          <AnimatedSplashOverlay />
          <AppTabs />
        </>
      )}
    </GestureHandlerRootView>
  );
}
