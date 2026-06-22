import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

// A softly-spinning 3D iPhone for the welcome carousel. WEB ENTRY for now — like the Venus Lab,
// this uses the @react-three/fiber web reconciler; the expo-gl/native swap is a later step, so the
// welcome falls back to a static frame on native (see welcome.tsx PhoneFrame). The phone body is a
// procedural rounded-rect extrusion and the screen is a soft brand-gradient placeholder; real
// per-slide app captures replace the screen texture once we have the screenshots.

const ACCENT = '#5BD8E6';

// A rounded-rectangle profile we extrude into the phone body (proper face-corner rounding that a
// RoundedBoxGeometry can't give on a thin slab — its radius is capped by the smallest dimension).
function roundedRectShape(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// A vertical brand gradient + soft glow so the screen reads as "on" (web canvas texture).
function makeScreenTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 540;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, '#0e2630');
  g.addColorStop(0.5, '#114050');
  g.addColorStop(1, '#0a1c26');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  const rg = ctx.createRadialGradient(128, 250, 6, 128, 250, 210);
  rg.addColorStop(0, 'rgba(120,232,244,0.6)');
  rg.addColorStop(0.4, 'rgba(91,216,230,0.32)');
  rg.addColorStop(1, 'rgba(91,216,230,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function Phone() {
  const group = useRef<THREE.Group>(null);
  const body = useMemo(() => {
    const shape = roundedRectShape(1.0, 2.04, 0.2);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.12,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.03,
      bevelSegments: 4,
      steps: 1,
      curveSegments: 18,
    });
    geo.center();
    return geo;
  }, []);
  const screenTex = useMemo(() => makeScreenTexture(), []);
  const frontZ = 0.09; // front of the body after centring (depth/2 + bevel)

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    // No full spin — the screen stays facing the viewer. Just a slow, slight sway + float so it
    // feels alive and you can read what's on the screen.
    g.rotation.y = Math.sin(t * 0.45) * 0.2; // gentle ±~11° left/right sway
    g.rotation.x = 0.03 + Math.sin(t * 0.35) * 0.03; // subtle nod
    g.position.y = Math.sin(t * 0.55) * 0.035; // soft float
  });

  return (
    <group ref={group} rotation={[0.05, 0, 0]}>
      {/* body */}
      <mesh geometry={body}>
        <meshStandardMaterial color="#0b0b11" metalness={0.92} roughness={0.34} />
      </mesh>
      {/* screen */}
      <mesh position={[0, 0, frontZ]}>
        <planeGeometry args={[0.9, 1.92]} />
        <meshBasicMaterial map={screenTex} toneMapped={false} />
      </mesh>
      {/* dynamic island */}
      <mesh position={[0, 0.82, frontZ + 0.002]}>
        <planeGeometry args={[0.24, 0.07]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
    </group>
  );
}

export default function PhoneScene() {
  return (
    <Canvas camera={{ position: [0, 0, 5], fov: 27 }} gl={{ alpha: true, antialias: true }} style={{ flex: 1 }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 4, 5]} intensity={1.25} />
      <pointLight position={[-3.5, -2, 3]} intensity={0.65} color={ACCENT} />
      <Phone />
    </Canvas>
  );
}
