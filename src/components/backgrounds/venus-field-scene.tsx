import { useEffect } from 'react';
import { Blur, Canvas, Group, Paint, Points, type SkPoint } from '@shopify/react-native-skia';
import { useWindowDimensions } from 'react-native';
import { Easing, useDerivedValue, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { FACE_EDGES, FACE_VERTS } from './face-mesh';

// ── Venus face mesh (POC) ───────────────────────────────────────────────────
// The dots morph into a defined FACE MESH (the canonical 468-vertex face) rendered
// as glowing nodes + a triangulated wireframe — the image-1 "plexus head" look. A
// single `morph` value (0 = scattered field, 1 = face) lerps every node between its
// scattered home and its mesh vertex; the wireframe edges fade in as she assembles.
// (Lip-sync will animate the known mouth vertices from her voice next.)

const N = FACE_VERTS.length; // 468
// each node's scattered "home" across the screen (0..1), fixed per node
const HOME: { x: number; y: number }[] = Array.from({ length: N }, () => ({ x: Math.random(), y: Math.random() }));

export default function VenusFieldScene() {
  const { width, height } = useWindowDimensions();
  const morph = useSharedValue(0); // 0 = scattered, 1 = face

  // POC loop: scattered → assemble into the face mesh → hold → disperse → repeat.
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

  // current node positions: lerp scattered home → mesh vertex
  const nodes = useDerivedValue<SkPoint[]>(() => {
    'worklet';
    const m = morph.value;
    const cx = width / 2;
    const cy = height * 0.46;
    const s = height * 0.58; // face size on screen
    const out: SkPoint[] = [];
    for (let i = 0; i < N; i++) {
      const h = HOME[i];
      const v = FACE_VERTS[i];
      const ax = h.x * width;
      const ay = h.y * height;
      const fx = cx + v[0] * s;
      const fy = cy + v[1] * s;
      out.push({ x: ax + (fx - ax) * m, y: ay + (fy - ay) * m });
    }
    return out;
  }, [width, height]);

  // wireframe edges as line-segment pairs between the current node positions
  const lines = useDerivedValue<SkPoint[]>(() => {
    'worklet';
    const p = nodes.value;
    const out: SkPoint[] = [];
    for (let e = 0; e < FACE_EDGES.length; e++) {
      out.push(p[FACE_EDGES[e][0]]);
      out.push(p[FACE_EDGES[e][1]]);
    }
    return out;
  }, []);

  // edges resolve only once the nodes have mostly settled (so the converge reads as a
  // swarm, then the mesh snaps into focus — no mid-flight tangle)
  const edgeOpacity = useDerivedValue(() => {
    'worklet';
    const t = Math.min(1, Math.max(0, (morph.value - 0.6) / 0.4));
    return t * t * (3 - 2 * t);
  }, []);

  return (
    <Canvas style={{ flex: 1 }}>
      {/* triangulated wireframe — resolves once the nodes settle */}
      <Group opacity={edgeOpacity}>
        <Group layer={<Paint><Blur blur={2.5} /></Paint>}>
          <Points points={lines} mode="lines" color="rgb(140,172,225)" style="stroke" strokeWidth={1.1} />
        </Group>
        <Points points={lines} mode="lines" color="rgb(185,205,242)" style="stroke" strokeWidth={0.6} />
      </Group>
      {/* glowing nodes — always present (they are the field when scattered) */}
      <Group layer={<Paint><Blur blur={3} /></Paint>}>
        <Points points={nodes} mode="points" color="rgb(205,222,255)" style="stroke" strokeWidth={3} strokeCap="round" />
      </Group>
      <Points points={nodes} mode="points" color="rgb(240,246,255)" style="stroke" strokeWidth={1.5} strokeCap="round" />
    </Canvas>
  );
}
