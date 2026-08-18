import { useState } from 'react';
import { View, type ViewStyle } from 'react-native';
import { Canvas, Image as SkiaImage, Group, useImage } from '@shopify/react-native-skia';

// OUR OWN, supplier-agnostic garment mockup (NATIVE build). Composites a design onto a garment PHOTO so
// it reads as PRINTED (ink on cloth), not a flat image-over-image — independent of any POD provider's
// mockup tech (the provider's own mockup is only used at approve/finalize). Native uses react-native-
// skia blend modes (RN <Image> has none); the WEB build (garment-mockup.web.tsx) uses CSS mix-blend-mode.
// The "printed" trick: draw the design over the garment with blendMode 'multiply' so the fabric's
// shadows/folds show THROUGH the ink. v1 targets light garments; dark-garment handling is a follow-up.

export type PrintRect = { x: number; y: number; w: number; h: number }; // fractions [0..1] of the garment photo

export function GarmentMockup({
  garmentUri,
  designUri,
  rect,
  style,
  blend = 'multiply',
}: {
  garmentUri: string;
  designUri: string | null;
  rect: PrintRect;
  style?: ViewStyle;
  blend?: 'multiply' | 'normal';
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const garment = useImage(garmentUri);
  const design = useImage(designUri);
  const { w, h } = size;
  return (
    <View style={style} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {w > 0 && h > 0 ? (
        <Canvas style={{ width: w, height: h }}>
          {garment ? <SkiaImage image={garment} x={0} y={0} width={w} height={h} fit="contain" /> : null}
          {design ? (
            <Group blendMode={blend === 'multiply' ? 'multiply' : 'srcOver'}>
              <SkiaImage image={design} x={rect.x * w} y={rect.y * h} width={rect.w * w} height={rect.h * h} fit="fill" />
            </Group>
          ) : null}
        </Canvas>
      ) : null}
    </View>
  );
}
