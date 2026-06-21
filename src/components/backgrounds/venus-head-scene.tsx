import { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ── Venus head (R3F POC) ────────────────────────────────────────────────────
// Step 2: prove a remote GLB loads and renders as our brand wireframe. We load it with
// a plain three GLTFLoader (NOT drei's useGLTF — that pulls in DRACO/meshopt loaders
// that use import.meta, which Metro can't eval). Auto-fits any model to ~2 units at the
// origin. Using a Khronos sample for now; SWAP `MODEL_URL` for the Ready Player Me
// Venus avatar (`?morphTargets=ARKit,Oculus Visemes`) once created — then we zoom to
// the head, render as glowing wireframe/dots, and drive the visemes from her voice.

const MODEL_URL = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Duck/glTF-Binary/Duck.glb';

function Model({ url }: { url: string }) {
  const [obj, setObj] = useState<THREE.Object3D | null>(null);
  useEffect(() => {
    let alive = true;
    new GLTFLoader().load(
      url,
      (gltf) => {
        if (!alive) return;
        const s = gltf.scene;
        const box = new THREE.Box3().setFromObject(s);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const k = 2 / Math.max(size.x, size.y, size.z);
        s.scale.setScalar(k);
        s.position.set(-center.x * k, -center.y * k, -center.z * k);
        s.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) m.material = new THREE.MeshBasicMaterial({ color: '#7cc7df', wireframe: true });
        });
        setObj(s);
      },
      undefined,
      (e) => console.error('[venus] GLTF load error', e),
    );
    return () => {
      alive = false;
    };
  }, [url]);

  return obj ? <primitive object={obj} /> : null;
}

export default function VenusHeadScene() {
  return (
    <Canvas camera={{ position: [0, 0, 3.4], fov: 45 }} style={{ flex: 1 }}>
      <color attach="background" args={['#08080a']} />
      <Model url={MODEL_URL} />
    </Canvas>
  );
}
