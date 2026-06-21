import { type ComponentType, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

// Native tabs swap instantly (no transition). This wraps a screen so its content does a quick,
// elegant fade-in every time the screen gains focus — softening the view-to-view change without
// touching the tab bar (only the content fades). Wrap a screen's default export:
//
//   export default withScreenFade(MyScreen)
//
// Fires on focus (every tab switch) and on first mount. Duration is intentionally short.
const DURATION = 220;

export function withScreenFade<P extends object>(Screen: ComponentType<P>) {
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
    return (
      <Animated.View style={[{ flex: 1 }, style]}>
        <Screen {...props} />
      </Animated.View>
    );
  }
  FadedScreen.displayName = `withScreenFade(${Screen.displayName || Screen.name || 'Screen'})`;
  return FadedScreen;
}
