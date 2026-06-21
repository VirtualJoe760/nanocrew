import { Canvas, Fill, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { useWindowDimensions } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';

// ── Neon "tracelight" field ────────────────────────────────────────────────
// A full-screen SkSL fragment shader: flowing neon ribbons drifting through deep
// space, with additive glow (free in Skia — no postprocessing bloom needed), a
// parallax starfield, and a vignette. Cool brand palette (cyan → platinum, faint
// violet halo). Driven by a single `u_time` uniform off the Skia clock.
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

  // deep-space base — a subtle cool wash, darker toward the edges
  float3 col = mix(float3(0.03, 0.04, 0.07), float3(0.0, 0.0, 0.0),
                   clamp(length(uv) * 0.9, 0.0, 1.0));

  // flowing neon traces — each a drifting sine ribbon with 1/d glow falloff
  float glow = 0.0;   // soft halo
  float core = 0.0;   // tight bright core
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float speed = 0.25 + fi * 0.12;
    float amp   = 0.32 - fi * 0.03;
    float freq  = 1.3 + fi * 0.55;
    float phase = fi * 1.7;
    float y = sin(uv.x * freq + t * speed + phase) * amp
            + sin(uv.x * freq * 0.5 - t * speed * 0.7) * amp * 0.4;
    float d = abs(uv.y - y);
    float thick = 0.0016 + 0.0010 * (0.5 + 0.5 * sin(t * 0.8 + fi));
    glow += thick / (d + 0.0015);
    core += (thick * 2.5) / (d * d * 60.0 + 0.02);
  }

  // color ramp: faint violet halo → cyan body → platinum-white core
  float3 violet = float3(0.55, 0.45, 1.00);
  float3 cyan   = float3(0.30, 0.80, 1.00);
  float3 white  = float3(0.85, 0.95, 1.00);
  float3 neon = mix(violet, cyan, clamp(glow * 0.5, 0.0, 1.0));
  neon = mix(neon, white, clamp(core * 0.8, 0.0, 1.0));
  col += neon * (glow * 0.16 + core * 0.20);

  // drifting starfield
  float2 cell = floor(fragCoord / 2.5);
  float star = step(0.992, hash21(cell)) * (0.4 + 0.6 * sin(t * 2.0 + hash21(cell + 3.1) * 30.0));
  col += float3(0.7, 0.85, 1.0) * star * 0.6;

  // vignette
  col *= 1.0 - 0.45 * dot(uv, uv);

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
