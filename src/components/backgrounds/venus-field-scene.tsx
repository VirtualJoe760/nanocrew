import { useEffect } from 'react';
import { Blur, Canvas, Group, Paint, Points, type SkPoint, useClock } from '@shopify/react-native-skia';
import { useWindowDimensions } from 'react-native';
import { Easing, useDerivedValue, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { FACE_DOTS, FACE_EDGES, FACE_VERTS } from './face-mesh';

// ── Venus face field (POC) ──────────────────────────────────────────────────
// Our dots (dense, glowing, colour-cycling) swarm from a scattered field and fill a
// FACE MESH — ~2200 dots sampled across the mesh surface assemble her face, with the
// triangulated wireframe (468 verts) resolving underneath as a subtle structural
// accent. One `morph` value lerps each particle home↔target; the wireframe fades in
// once the dots settle. Colour cycles over time like the background. Loops.
// (Lip-sync will animate the known mouth vertices from her voice next.)

const ND = FACE_DOTS.length; // 2200 — the dots
const NV = FACE_VERTS.length; // 468 — wireframe nodes
const HOME_D = Array.from({ length: ND }, () => ({ x: Math.random(), y: Math.random() }));
const HOME_V = Array.from({ length: NV }, () => ({ x: Math.random(), y: Math.random() }));

// hue (0..1) → Skia ARGB color number, fully saturated-ish
function hueColor(h: number, sat: number) {
  'worklet';
  const v = 1.0;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - sat);
  const q = v * (1 - f * sat);
  const t = v * (1 - (1 - f) * sat);
  let r = v, g = t, b = p;
  const m = ((i % 6) + 6) % 6;
  if (m === 1) { r = q; g = v; b = p; }
  else if (m === 2) { r = p; g = v; b = t; }
  else if (m === 3) { r = p; g = q; b = v; }
  else if (m === 4) { r = t; g = p; b = v; }
  else if (m === 5) { r = v; g = p; b = q; }
  const R = Math.round(r * 255), G = Math.round(g * 255), B = Math.round(b * 255);
  return 0xff000000 + R * 65536 + G * 256 + B;
}

export default function VenusFieldScene() {
  const { width, height } = useWindowDimensions();
  const clock = useClock();
  const morph = useSharedValue(0); // 0 = scattered, 1 = face

  useEffect(() => {
    morph.value = withRepeat(
      withSequence(
        withDelay(1200, withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.cubic) })),
        withDelay(3200, withTiming(0, { duration: 1700, easing: Easing.in(Easing.cubic) })),
      ),
      -1,
      false,
    );
  }, [morph]);

  const place = (home: { x: number; y: number }[], target: [number, number, number][], n: number) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useDerivedValue<SkPoint[]>(() => {
      'worklet';
      const m = morph.value;
      const cx = width / 2;
      const cy = height * 0.46;
      const s = height * 0.58;
      const out: SkPoint[] = [];
      for (let i = 0; i < n; i++) {
        const h = home[i];
        const v = target[i];
        const ax = h.x * width;
        const ay = h.y * height;
        const fx = cx + v[0] * s;
        const fy = cy + v[1] * s;
        out.push({ x: ax + (fx - ax) * m, y: ay + (fy - ay) * m });
      }
      return out;
    }, [width, height]);

  const dots = place(HOME_D, FACE_DOTS, ND);
  const wnodes = place(HOME_V, FACE_VERTS, NV);

  const lines = useDerivedValue<SkPoint[]>(() => {
    'worklet';
    const p = wnodes.value;
    const out: SkPoint[] = [];
    for (let e = 0; e < FACE_EDGES.length; e++) {
      out.push(p[FACE_EDGES[e][0]]);
      out.push(p[FACE_EDGES[e][1]]);
    }
    return out;
  }, []);

  const edgeOpacity = useDerivedValue(() => {
    'worklet';
    const t = Math.min(1, Math.max(0, (morph.value - 0.6) / 0.4));
    return t * t * (3 - 2 * t) * 0.6;
  }, []);

  // dots cycle hue over time, like the background
  const dotColor = useDerivedValue(() => {
    'worklet';
    return hueColor(((clock.value / 1000) * 0.09) % 1, 0.55);
  }, []);

  return (
    <Canvas style={{ flex: 1 }}>
      {/* subtle wireframe accent — resolves once the dots settle */}
      <Group opacity={edgeOpacity}>
        <Group layer={<Paint><Blur blur={1.5} /></Paint>}>
          <Points points={lines} mode="lines" color="rgb(150,180,225)" style="stroke" strokeWidth={0.8} />
        </Group>
      </Group>

      {/* the dots — dense, glowing, colour-cycling */}
      <Group layer={<Paint><Blur blur={3.5} /></Paint>}>
        <Points points={dots} mode="points" color={dotColor} style="stroke" strokeWidth={3.6} strokeCap="round" />
      </Group>
      <Points points={dots} mode="points" color="rgb(244,248,255)" style="stroke" strokeWidth={1.3} strokeCap="round" />
    </Canvas>
  );
}
