import { type ComponentType, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { AppBackground } from '@/components/backgrounds/app-background';

// Native tabs swap instantly (no transition). This wraps a screen so its content does a quick,
// elegant fade-in every time the screen gains focus — softening the view-to-view change without
// touching the tab bar (only the content fades). Wrap a screen's default export:
//
//   export default withScreenFade(MyScreen)                        // content fades, no background
//   export default withScreenFade(MyScreen, { background: true })  // + the opaque dot-field, NOT faded
//   export default withScreenFade(MyScreen, { eveThrough: true })  // translucent scrim over the root Eve
//
// Pass `background: true` to render the opaque dot-field <AppBackground/> BEHIND the fading content.
// Pass `eveThrough: true` (THE PIVOT — docs/studio/EVE_CONTROL.md) for a translucent scrim instead:
// the persistent root Eve (see _layout / eve-background) shows through, dimmed just enough for text.
// Either layer lives here (outside the Animated.View) — not inside the screen — so it doesn't fade
// from black on every focus, which is what made tab transitions flash. (On native the background has
// to be rendered per-screen anyway: NativeTabs/UITabBarController covers a background at the _layout
// root.) Fires on focus (every tab switch) and on first mount. Duration is intentionally short.
const DURATION = 220;

// The scrim that dims the live Eve behind a page enough that page text keeps its contrast. Dark and
// mostly-opaque, but she still reads as present underneath. Transparent bed so she isn't occluded.
const EVE_SCRIM = 'rgba(6,8,12,0.62)';

export function withScreenFade<P extends object>(
  Screen: ComponentType<P>,
  opts?: { background?: boolean; eveThrough?: boolean },
) {
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
    // `eveThrough`: a transparent bed + a translucent scrim, so the root Eve is visible behind the page.
    // Otherwise sit on a brand-dark bed (in front of the white iOS view-controller background, which a
    // root-level dark colour can't cover) so the focus-fade never reveals white during a tab change.
    const eveThrough = opts?.eveThrough;
    return (
      <View style={{ flex: 1, backgroundColor: eveThrough ? 'transparent' : '#08080a' }}>
        {eveThrough ? (
          <View pointerEvents="none" style={[{ backgroundColor: EVE_SCRIM }, StyleSheet.absoluteFill]} />
        ) : opts?.background ? (
          <AppBackground />
        ) : null}
        <Animated.View style={[{ flex: 1 }, style]}>
          <Screen {...props} />
        </Animated.View>
      </View>
    );
  }
  FadedScreen.displayName = `withScreenFade(${Screen.displayName || Screen.name || 'Screen'})`;
  return FadedScreen;
}
