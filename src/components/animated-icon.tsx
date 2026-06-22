import { Image } from 'expo-image';
import { useState } from 'react';
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
