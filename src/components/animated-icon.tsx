import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { Keyframe } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

// Boot loader: the vertical Venus portrait holds full-screen over the app on launch, then fades out
// once it's ready — replacing the old logo loader. The native splash (app.json) shows the SAME
// portrait first, so the launch → loader → app sequence is seamless. Art: assets/brand/venus-portrait.png.
const DURATION = 1100;

const holdThenFade = new Keyframe({
  0: { opacity: 1 },
  55: { opacity: 1 },
  100: { opacity: 0 },
});

export function AnimatedSplashOverlay() {
  const [visible, setVisible] = useState(true);
  // Belt-and-suspenders dismissal. The reanimated `entering` callback below removes the overlay when
  // the fade finishes — but on WEB that worklet callback is unreliable (the Keyframe plays, yet
  // `withCallback` can be dropped), which left this black overlay (#000, zIndex 1000) stuck on top of
  // the whole app, blanking the screen with the content still mounted underneath. A timeout clears it
  // unconditionally after the animation's duration, so the app can never get wedged behind it.
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), DURATION + 150);
    return () => clearTimeout(t);
  }, []);
  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={styles.overlay}
      entering={holdThenFade.duration(DURATION).withCallback((finished) => {
        'worklet';
        if (finished) {
          scheduleOnRN(setVisible, false);
        }
      })}>
      <Image
        source={require('@/assets/brand/venus-portrait.png')}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000', // matches the portrait's black field + the native splash
    zIndex: 1000,
  },
});
