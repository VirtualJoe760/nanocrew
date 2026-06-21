import { Canvas, Fill, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { useWindowDimensions } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';

// ── Dark space ─────────────────────────────────────────────────────────────
// A minimal, very dark "deep space" background — a near-black radial depth wash,
// a faint slow nebula breath, a sparse twinkling starfield, and a dark vignette.
// Intentionally bare: a clean canvas to build the background on. Driven by a
// single `u_time` uniform off the Skia clock.
//
// SkSL ≈ GLSL: half4 main(float2 fragCoord), float2/float3/half4, bounded loops,
// helpers declared before use. Tweak the constants below and HMR shows it live.
const SKSL = `
uniform float2 u_resolution;
uniform float  u_time;

float hash21(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

half4 main(float2 fragCoord) {
  // centered, aspect-correct coordinates
  float2 uv = (fragCoord - 0.5 * u_resolution) / u_resolution.y;
  float t = u_time;
  float d = length(uv);

  // very dark base — near-black, a touch of cool depth toward the center
  float3 col = mix(float3(0.018, 0.022, 0.035), float3(0.003, 0.004, 0.010),
                   clamp(d * 1.1, 0.0, 1.0));

  // a faint, slow nebula breath for depth (extremely subtle)
  float neb = 0.5 + 0.5 * sin(t * 0.15);
  col += float3(0.02, 0.03, 0.05) * (1.0 - clamp(d, 0.0, 1.0)) * neb * 0.35;

  // sparse, subtle stars with a gentle twinkle
  float2 cell = floor(fragCoord / 3.0);
  float h = hash21(cell);
  float star = step(0.9965, h) * (0.45 + 0.55 * sin(t * 1.5 + h * 40.0));
  col += float3(0.7, 0.8, 1.0) * star * 0.5;

  // dark vignette
  col *= 1.0 - 0.5 * d * d;

  return half4(col, 1.0);
}
`;

const effect = Skia.RuntimeEffect.Make(SKSL);

export default function PlaygroundScene() {
  const { width, height } = useWindowDimensions();
  const clock = useClock(); // elapsed ms, as a shared value
  const uniforms = useDerivedValue(
    () => ({ u_time: clock.value / 1000, u_resolution: [width, height] }),
    [width, height],
  );

  if (!effect) return null; // shader failed to compile

  return (
    <Canvas style={{ flex: 1 }}>
      <Fill>
        <Shader source={effect} uniforms={uniforms} />
      </Fill>
    </Canvas>
  );
}
