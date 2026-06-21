import { Canvas, Fill, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { useWindowDimensions } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';

// ── Dark space ─────────────────────────────────────────────────────────────
// A dark "deep space" background: a near-black base with a touch of cool depth,
// a very subtle drifting nebula, and a twinkling two-layer starfield (small crisp
// stars with a faint halo). Dark and minimal, but clearly visible — a clean canvas
// to build on. Driven by a single `u_time` uniform off the Skia clock.
//
// SkSL ≈ GLSL: half4 main(float2 fragCoord), float2/float3/half4, helpers declared
// before use. Tweak the constants below and HMR shows it live.
//   - star density  → the `thresh` args to starLayer (higher = fewer stars)
//   - star size      → the smoothstep cutoffs in starLayer (core / halo)
//   - nebula strength → the `* 0.45` on the nebula line
const SKSL = `
uniform float2 u_resolution;
uniform float  u_time;

float hash21(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// smooth value noise (for the nebula)
float vnoise(float2 p) {
  float2 i = floor(p), f = fract(p);
  float a = hash21(i), b = hash21(i + float2(1, 0));
  float c = hash21(i + float2(0, 1)), e = hash21(i + float2(1, 1));
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, e, u.x), u.y);
}

// one parallax star layer — small crisp core + faint halo, gentle twinkle
float starLayer(float2 p, float t, float thresh) {
  float2 cell = floor(p), f = fract(p) - 0.5;
  float h = hash21(cell);
  float on = step(thresh, h);
  float2 sp = (float2(hash21(cell + 3.1), hash21(cell + 5.7)) - 0.5) * 0.7;
  float dist = length(f - sp);
  float tw = 0.5 + 0.5 * sin(t * 2.0 + h * 40.0);
  float core = smoothstep(0.06, 0.0, dist);
  float halo = smoothstep(0.30, 0.0, dist) * 0.22;
  return on * tw * (core + halo);
}

half4 main(float2 fragCoord) {
  float2 uv = (fragCoord - 0.5 * u_resolution) / u_resolution.y;
  float t = u_time;
  float d = length(uv);

  // dark base — a hint of cool depth toward the center
  float3 col = mix(float3(0.04, 0.05, 0.08), float3(0.008, 0.01, 0.02),
                   clamp(d * 0.95, 0.0, 1.0));

  // very subtle drifting nebula
  float n = vnoise(uv * 2.2 + float2(t * 0.025, t * 0.015));
  n *= vnoise(uv * 1.1 - float2(t * 0.015, t * 0.01));
  col += mix(float3(0.05, 0.09, 0.18), float3(0.12, 0.07, 0.18), n)
         * smoothstep(0.45, 0.95, n) * 0.45 * (1.0 - 0.45 * d);

  // two star layers (bright/sparse + faint/dense) for depth
  float s1 = starLayer(uv * 20.0, t, 0.90);
  float s2 = starLayer(uv * 36.0, t * 0.8, 0.86);
  col += float3(0.90, 0.93, 1.0) * s1 + float3(0.70, 0.80, 1.0) * s2 * 0.6;

  // gentle vignette
  col *= 1.0 - 0.4 * d * d;

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
