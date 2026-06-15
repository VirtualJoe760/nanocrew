import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';

// Hold the native splash until General Sans (the brand sans) is loaded, so text never
// flashes in the system font first.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function TabLayout() {
  const [fontsLoaded] = useFonts({
    'GeneralSans-Regular': require('../../assets/fonts/GeneralSans-Regular.ttf'),
    'GeneralSans-Medium': require('../../assets/fonts/GeneralSans-Medium.ttf'),
    'GeneralSans-Semibold': require('../../assets/fonts/GeneralSans-Semibold.ttf'),
    'GeneralSans-Bold': require('../../assets/fonts/GeneralSans-Bold.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AnimatedSplashOverlay />
      <AppTabs />
    </GestureHandlerRootView>
  );
}
