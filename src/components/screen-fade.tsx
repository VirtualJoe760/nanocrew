import { type ComponentType, useCallback } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { AppBackground } from '@/components/backgrounds/app-background';

// Native tabs swap instantly (no transition). This wraps a screen so its content does a quick,
// elegant fade-in every time the screen gains focus — softening the view-to-view change without
// touching the tab bar (only the content fades). Wrap a screen's default export:
//
//   export default withScreenFade(MyScreen)               // content fades, no background
//   export default withScreenFade(MyScreen, { background: true })  // + the dot-field, NOT faded
//
// Pass `background: true` to render the dot-field <AppBackground/> BEHIND the fading content. It must
// live here (outside the Animated.View) — not inside the screen — so it doesn't fade from black on
// every focus, which is what made tab transitions flash. (On native the background has to be rendered
// per-screen anyway: NativeTabs/UITabBarController covers a background placed at the _layout root.)
// Fires on focus (every tab switch) and on first mount. Duration is intentionally short.
const DURATION = 220;

export function withScreenFade<P extends object>(Screen: ComponentType<P>, opts?: { background?: boolean }) {
  function FadedScreen(props: P) {
    const opacity = useSharedValue(0);
    useFocusEffect(
      useCallback(() => {
        opacity.value = 0;
        opacity.value = withTiming(1, { duration: DURATION, easing: Easing.out(Easing.cubic) });
        return () => {
          opacity.value = 0;
        };
      }, [opacity]),
    );
    const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
    const content = (
      <Animated.View style={[{ flex: 1 }, style]}>
        <Screen {...props} />
      </Animated.View>
    );
    if (!opts?.background) return content;
    return (
      <View style={{ flex: 1 }}>
        <AppBackground />
        {content}
      </View>
    );
  }
  FadedScreen.displayName = `withScreenFade(${Screen.displayName || Screen.name || 'Screen'})`;
  return FadedScreen;
}
