import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ── Venus head (R3F POC) ────────────────────────────────────────────────────
// Step 3: a real Ready Player Me head with the full Oculus viseme set baked in,
// rendered as our brand wireframe. We compute the head's bounding box after load and
// aim the camera at it (the GLB scale/position is unknown), then pulse one viseme to
// prove the rig drives the mouth. Next: drive ALL visemes from her Gemini audio.

const AVATAR_URL =
  'https://raw.githubusercontent.com/wass08/r3f-lipsync-tutorial/main/public/models/646d9dcdc8a5f5bddbfac913.glb';

function Avatar({ url }: { url: string }) {
  const { camera } = useThree();
  const [root, setRoot] = useState<THREE.Object3D | null>(null);
  const head = useRef<THREE.Mesh | null>(null);

  useEffect(() => {
    let alive = true;
    new GLTFLoader().load(
      url,
      (gltf) => {
        if (!alive) return;
        let headMesh: THREE.Mesh | null = null;
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.material = new THREE.MeshBasicMaterial({ color: '#7cc7df', wireframe: true });
          if (m.morphTargetDictionary && m.morphTargetDictionary['viseme_aa'] !== undefined) headMesh = m;
        });
        head.current = headMesh;

        // The skinned head bbox is unreliable; frame off the known full-avatar scale
        // (1.85m tall, head at the top). Aim at the face; face is at +z, so sit in front.
        const sceneBox = new THREE.Box3().setFromObject(gltf.scene);
        const topY = sceneBox.max.y; // ~hair top
        const aimY = topY - 0.24; // roughly eye/nose level
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

  // TEST: pulse the "aa" viseme so we can see the mouth open/close (proves the rig).
  useFrame((state) => {
    const h = head.current;
    if (h?.morphTargetInfluences && h.morphTargetDictionary) {
      const i = h.morphTargetDictionary['viseme_aa'];
      h.morphTargetInfluences[i] = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 4);
    }
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
