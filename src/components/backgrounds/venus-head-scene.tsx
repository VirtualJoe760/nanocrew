import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ── Venus head (R3F POC) ────────────────────────────────────────────────────
// Step 4: a FEMALE Ready Player Me head (full ARKit blendshapes + Oculus visemes),
// rendered as our wireframe, made LIVELY — blinks, eye darts, idle head sway, brow
// flashes, a resting smile — layered under a talking-mouth viseme pulse. This proves
// the geometry animates lifelike. Next: drive visemes from her real Gemini audio.
//
// Demo avatar is CC BY-NC (non-commercial) — the user's own RPM Venus (which they
// license) swaps in for production via the same code.

const AVATAR_URL = 'https://raw.githubusercontent.com/met4citizen/TalkingHead/main/avatars/brunette.glb';
const DEG = Math.PI / 180;

type Rig = {
  meshes: THREE.Mesh[];
  bones: { head?: THREE.Object3D; neck?: THREE.Object3D; leftEye?: THREE.Object3D; rightEye?: THREE.Object3D };
  rest: Map<THREE.Object3D, THREE.Euler>;
};

function Avatar({ url }: { url: string }) {
  const { camera } = useThree();
  const [root, setRoot] = useState<THREE.Object3D | null>(null);
  const rig = useRef<Rig | null>(null);
  const a = useRef({ nextBlink: 1.2, blinkAt: -1, nextSacc: 0.6, gx: 0, gy: 0, nextBrow: 2.5, browAt: -1, browAmt: 0 });

  useEffect(() => {
    let alive = true;
    new GLTFLoader().load(
      url,
      (gltf) => {
        if (!alive) return;
        const meshes: THREE.Mesh[] = [];
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.material = new THREE.MeshBasicMaterial({ color: '#7cc7df', wireframe: true });
          if (m.morphTargetDictionary) meshes.push(m);
        });
        const get = (n: string) => gltf.scene.getObjectByName(n) ?? undefined;
        const bones = { head: get('Head'), neck: get('Neck'), leftEye: get('LeftEye'), rightEye: get('RightEye') };
        const rest = new Map<THREE.Object3D, THREE.Euler>();
        Object.values(bones).forEach((b) => b && rest.set(b, b.rotation.clone()));
        rig.current = { meshes, bones, rest };

        // frame the face off the known avatar scale (head at the top, face at +z)
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const aimY = box.max.y - 0.24;
        camera.position.set(0, aimY, 1.0);
        camera.lookAt(0, aimY, 0);
        camera.updateProjectionMatrix();
        setRoot(gltf.scene);
      },
      undefined,
      (e) => console.error('[venus] GLTF load error', e),
    );
    return () => {
      alive = false;
    };
  }, [url, camera]);

  useFrame((st) => {
    const r = rig.current;
    if (!r) return;
    const t = st.clock.elapsedTime;
    const s = a.current;
    const set = (name: string, v: number) => {
      for (const m of r.meshes) {
        const i = m.morphTargetDictionary?.[name];
        if (i !== undefined && m.morphTargetInfluences) m.morphTargetInfluences[i] = v;
      }
    };
    const sway = (b: THREE.Object3D | undefined, x: number, y: number, z: number) => {
      if (!b) return;
      const rr = r.rest.get(b)!;
      b.rotation.set(rr.x + x, rr.y + y, rr.z + z);
    };

    // blink — eyelids close + open (0→1→0)
    if (s.blinkAt < 0 && t > s.nextBlink) s.blinkAt = t;
    let blink = 0;
    if (s.blinkAt >= 0) {
      const p = (t - s.blinkAt) / 0.14;
      if (p >= 1) {
        s.blinkAt = -1;
        s.nextBlink = t + 2 + Math.random() * 3.5;
      } else blink = Math.sin(p * Math.PI);
    }
    set('eyeBlinkLeft', blink);
    set('eyeBlinkRight', blink);

    // idle head + neck sway (from rest, mixed slow sines)
    sway(r.bones.head, Math.sin(t * 0.7) * 2 * DEG, Math.sin(t * 0.53) * 2.4 * DEG, Math.sin(t * 0.37) * 1 * DEG);
    sway(r.bones.neck, Math.sin(t * 0.7) * 1 * DEG, Math.sin(t * 0.53) * 1.2 * DEG, 0);

    // eye saccades — small darts, new target every ~0.3-1.2s
    if (t > s.nextSacc) {
      s.gx = (Math.random() - 0.5) * 2;
      s.gy = (Math.random() - 0.5) * 1.2;
      s.nextSacc = t + 0.3 + Math.random() * 0.9;
    }
    sway(r.bones.leftEye, s.gy * 4 * DEG, s.gx * 5 * DEG, 0);
    sway(r.bones.rightEye, s.gy * 4 * DEG, s.gx * 5 * DEG, 0);

    // brow micro-flashes over a faint baseline
    if (s.browAt < 0 && t > s.nextBrow) {
      s.browAt = t;
      s.browAmt = 0.15 + Math.random() * 0.2;
    }
    let brow = 0.04;
    if (s.browAt >= 0) {
      const p = (t - s.browAt) / 0.7;
      if (p >= 1) {
        s.browAt = -1;
        s.nextBrow = t + 3 + Math.random() * 5;
      } else brow = 0.04 + s.browAmt * Math.sin(p * Math.PI);
    }
    set('browInnerUp', brow);

    // faint resting smile (Mona-Lisa level)
    set('mouthSmileLeft', 0.1);
    set('mouthSmileRight', 0.1);

    // lip-sync TEST: pulse the "aa" viseme so the mouth talks
    set('viseme_aa', 0.5 + 0.5 * Math.sin(t * 5));
  });

  return root ? <primitive object={root} /> : null;
}

export default function VenusHeadScene() {
  return (
    <Canvas camera={{ position: [0, 0, 2], fov: 22 }} style={{ flex: 1 }}>
      <color attach="background" args={['#08080a']} />
      <Avatar url={AVATAR_URL} />
    </Canvas>
  );
}
