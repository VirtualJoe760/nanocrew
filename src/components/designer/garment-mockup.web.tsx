import type { ViewStyle } from 'react-native';

// OUR OWN, supplier-agnostic garment mockup (web build). Composites a design onto a garment PHOTO so it
// reads as PRINTED (ink on cloth) instead of a flat image-over-image. No dependence on any POD
// provider's mockup tech — it works from any blank photo + a normalized print rect; the provider's own
// mockup (Printful etc.) is only used at the approve/finalize stage. Web uses CSS mix-blend-mode (which
// RN <Image> lacks); the NATIVE build (garment-mockup.tsx) uses react-native-skia blend modes.
//
// The "printed" trick: the design is laid in the print rect with mixBlendMode='multiply', so the
// garment's own fabric shadows + folds show THROUGH the ink (and a white tee tints the art). For a v1
// this looks right on light garments; dark-garment handling (opaque ink + a fabric-grain overlay) is a
// documented follow-up.

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
  return (
    <div style={{ position: 'relative', overflow: 'hidden', width: '100%', ...(style as object) }}>
      <img src={garmentUri} alt="" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
      {designUri ? (
        <img
          src={designUri}
          alt=""
          style={{
            position: 'absolute',
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.w * 100}%`,
            height: `${rect.h * 100}%`,
            // fill, not contain — the rect IS the design's aspect-locked box; contain letterboxed
            // the art inside its own outline whenever the screen mapping is anisotropic.
            objectFit: 'fill',
            mixBlendMode: blend === 'multiply' ? 'multiply' : 'normal',
          }}
        />
      ) : null}
    </div>
  );
}
