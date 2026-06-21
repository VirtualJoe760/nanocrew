import { Canvas, Fill, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { useWindowDimensions } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';

// ── Laser tracelights ──────────────────────────────────────────────────────
// Sweeping neon "laser" beams over a dark starfield: each beam is a razor-thin
// bright core + an intense 1/d glow halo, slowly sweeping its angle, with a hot
// pulse travelling along it. Cool palette (cyan / violet / white). Driven by a
// single `u_time` uniform off the Skia clock.
//
// SkSL ≈ GLSL: half4 main(float2 fragCoord), float2/float3/half4, helpers declared
// before use. Tweak and HMR shows it live.
//   - core sharpness → the smoothstep(0.005,..) in laser() (smaller = thinner)
//   - glow intensity → the 0.008 / (dperp + 0.010) numerator
//   - beams          → add/remove laser(...) calls in main()
const SKSL = `
uniform float2 u_resolution;
uniform float  u_time;

float hash21(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// one laser beam — razor core + glowing halo, gently sweeping, with a travelling pulse
float3 laser(float2 uv, float angle, float offset, float t, float speed, float3 tint) {
  float a = angle + 0.30 * sin(t * speed + offset * 3.0);   // gentle sweep
  float2 perp = float2(-sin(a), cos(a));
  float dperp = abs(dot(uv, perp) - offset);                // perpendicular distance to the beam
  float core = smoothstep(0.005, 0.0, dperp);               // razor-thin bright core
  float halo = 0.008 / (dperp + 0.010);                     // intense 1/d glow falloff
  float2 dir = float2(cos(a), sin(a));
  float along = dot(uv, dir);
  float head = fract(t * 0.20 + offset * 2.0) * 2.6 - 1.3;  // hot point sweeping along the beam
  float pulse = smoothstep(0.22, 0.0, abs(along - head));
  return tint * (halo * 0.85 + core * 1.4 + core * pulse * 2.0);
}

half4 main(float2 fragCoord) {
  float2 uv = (fragCoord - 0.5 * u_resolution) / u_resolution.y;
  float t = u_time;
  float d = length(uv);

  // dark space base
  float3 col = mix(float3(0.02, 0.025, 0.04), float3(0.004, 0.005, 0.012),
                   clamp(d, 0.0, 1.0));

  // faint round stars behind the beams
  float2 sc = uv * 28.0;
  float2 scell = floor(sc), sf = fract(sc) - 0.5;
  float sh = hash21(scell);
  float2 spos = (float2(hash21(scell + 3.1), hash21(scell + 5.7)) - 0.5) * 0.7;
  float star = step(0.92, sh) * smoothstep(0.09, 0.0, length(sf - spos)) * (0.4 + 0.4 * sin(t * 1.5 + sh * 40.0));
  col += float3(0.6, 0.7, 1.0) * star * 0.5;

  // sweeping laser beams (cool palette)
  float3 cyan   = float3(0.30, 0.85, 1.00);
  float3 violet = float3(0.62, 0.42, 1.00);
  float3 white  = float3(0.85, 0.95, 1.00);
  col += laser(uv,  0.55, -0.18, t, 0.50, cyan);
  col += laser(uv, -0.65,  0.22, t, 0.42, violet);
  col += laser(uv,  1.15,  0.05, t, 0.60, white);
  col += laser(uv, -0.25, -0.32, t, 0.36, cyan);
  col += laser(uv,  0.95,  0.34, t, 0.48, violet);

  // vignette
  col *= 1.0 - 0.30 * d * d;

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
