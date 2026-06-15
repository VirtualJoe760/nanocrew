import { useState } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Image } from 'expo-image';

// A swipeable, paged 1:1 image carousel with Instagram-style dots. Square = `size` per page.
export function SquareCarousel({
  images,
  size,
  accent,
  radius = 0,
}: {
  images: string[];
  size: number;
  accent: string;
  radius?: number;
}) {
  const [idx, setIdx] = useState(0);

  if (!images.length) {
    return <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: `${accent}14` }} />;
  }
  if (images.length === 1) {
    return <Image source={{ uri: images[0] }} style={{ width: size, height: size, borderRadius: radius }} contentFit="cover" />;
  }

  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / size);
    if (i !== idx) setIdx(i);
  };

  return (
    <View style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden' }}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onEnd}
      >
        {images.map((u, i) => (
          <Image key={`${u}-${i}`} source={{ uri: u }} style={{ width: size, height: size }} contentFit="cover" />
        ))}
      </ScrollView>
      <View style={styles.dots} pointerEvents="none">
        {images.map((_, i) => (
          <View key={i} style={[styles.dot, { backgroundColor: accent, opacity: i === idx ? 1 : 0.35 }]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dots: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
