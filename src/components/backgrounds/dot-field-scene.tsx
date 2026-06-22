import { Canvas, Fill, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';

// ── Dot field ───────────────────────────────────────────────────────────────
// The app's signature animated background: a fine grid of dots that cycle through
// the full RGB spectrum (also passing through white and black), driven by an energy
// wave whose MOTION PATTERN is randomized over time — every ~12s it picks a new
// pattern (diagonal / radial ripple / cross-sweep / spiral / per-dot twinkle) and
// crossfades to it. Single `u_time` uniform off the Skia clock.
//
// This is the Skia "scene" (the <Canvas>); screens render it via <AppBackground>,
// which handles web (CanvasKit) vs native. Default export so it can be lazy-loaded
// on web. Tweak and HMR shows it live.
const SKSL = `
uniform float2 u_resolution;
uniform float  u_time;

float hash21(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float3 hsv2rgb(float3 c) {
  float3 p = abs(fract(c.xxx + float3(1.0, 0.6666667, 0.3333333)) * 6.0 - 3.0);
  return c.z * mix(float3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// energy (0..1) for one motion pattern, chosen by 'sel'
float motionEnergy(float sel, float2 cell, float t) {
  float e;
  if (sel < 0.2)      e = sin((cell.x + cell.y) * 0.28 - t * 1.1);                        // diagonal wave
  else if (sel < 0.4) e = sin(length(cell) * 0.30 - t * 0.9);                             // radial ripple
  else if (sel < 0.6) e = sin(cell.x * 0.32 - t) * 0.6 + sin(cell.y * 0.32 - t * 0.7) * 0.6; // cross sweep
  else if (sel < 0.8) e = sin(atan(cell.y, cell.x) * 3.0 + length(cell) * 0.25 - t);      // spiral
  else                e = sin(t * 1.3 + hash21(cell) * 6.2831);                           // per-dot twinkle
  return 0.5 + 0.5 * e;
}

half4 main(float2 fragCoord) {
  float2 uv = (fragCoord - 0.5 * u_resolution) / u_resolution.y;
  float t = u_time;
  float d = length(uv);

  // near-black base
  float3 col = float3(0.012, 0.013, 0.02) * (1.0 - 0.4 * d);

  // dot grid, slowly drifting (parallax)
  float scale = 34.0;
  float2 g = (uv + float2(t * 0.010, t * 0.006)) * scale;
  float2 cell = floor(g);
  float2 f = fract(g) - 0.5;

  // randomized motion rotation — new random pattern every PHASE seconds, crossfaded
  float PHASE = 12.0;
  float seg = t / PHASE;
  float idx = floor(seg);
  float fade = smoothstep(0.82, 1.0, fract(seg));
  float selA = hash21(float2(idx, 7.0));
  float selB = hash21(float2(idx + 1.0, 7.0));
  float energy = mix(motionEnergy(selA, cell, t), motionEnergy(selB, cell, t), fade);

  // small dots
  float r = mix(0.05, 0.12, energy);
  float dotv = smoothstep(r, r * 0.3, length(f));

  // colour cycles hue over time (+ gentle spatial gradient); saturation breathes to
  // white; value comes from the energy wave so troughs fall to black.
  float hue = fract(t * 0.10 + (cell.x + cell.y) * 0.02);
  float sat = 0.5 + 0.5 * sin(t * 0.20);
  float val = 0.05 + 0.95 * energy;
  col += hsv2rgb(float3(hue, sat, val)) * dotv;

  // gentle vignette
  col *= 1.0 - 0.30 * d * d;

  return half4(col, 1.0);
}
`;

export default function DotFieldScene() {
  const { width, height } = useWindowDimensions();
  const clock = useClock(); // elapsed ms, as a shared value
  // Compile the shader at render time, NOT module-load time. At module load (when _layout first
  // imports this on native) the Skia runtime may not be ready yet, so a top-level
  // Skia.RuntimeEffect.Make(SKSL) returns null once and the scene renders nothing forever.
  const effect = useMemo(() => Skia.RuntimeEffect.Make(SKSL), []);
  // Clamp the resolution to >= 1 so the shader never divides by zero. useWindowDimensions returns
  // 0x0 on the first frame before layout settles; an unclamped 0 height makes `uv / u_resolution.y`
  // produce NaN/Inf, which CanvasKit (web) aborts on every frame and which renders blank on native.
  const uniforms = useDerivedValue(
    () => ({ u_time: clock.value / 1000, u_resolution: [Math.max(1, width), Math.max(1, height)] }),
    [width, height],
  );

  // Don't mount the canvas until we have real dimensions — avoids the 0x0 first frame entirely.
  if (!effect || width < 1 || height < 1) return null;

  return (
    <Canvas style={{ flex: 1 }}>
      <Fill>
        <Shader source={effect} uniforms={uniforms} />
      </Fill>
    </Canvas>
  );
}
