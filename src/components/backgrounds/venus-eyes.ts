import * as THREE from 'three';
import { SCLERA_COLOR } from './venus-textures';

// Venus eyes — sclera + iris sprites grouped at the origin so the scene can aim them at the
// camera each frame. Extracted from venus-head-scene.tsx.
export const EYE_R = 0.013; // eyeball radius — the iris sits this far from the eye centre
// An eye parented to an eye bone — a readable iris (ring + dark pupil + catchlight) over
// a faint halo + a SCLERA (eye-white), grouped at the origin so `useFrame` can AIM the whole
// eye at the camera (so she looks at the user, not off into space).
export function makeIris(bone: THREE.Object3D | undefined, irisTex: THREE.Texture, scleraTex: THREE.Texture, dotTex: THREE.Texture, eyeObjs: THREE.Object3D[]): THREE.Material[] {
  if (!bone) return [];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3)); // at the group origin; the group is aimed each frame
  const scleraMat = new THREE.PointsMaterial({
    size: 0.058, map: scleraTex, color: new THREE.Color(SCLERA_COLOR), opacity: 0.75,
    transparent: true, sizeAttenuation: true, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: false,
  });
  const haloMat = new THREE.PointsMaterial({
    size: 0.016, map: dotTex, color: new THREE.Color('#2f6f8a'), opacity: 0.22,
    transparent: true, sizeAttenuation: true, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: false,
  });
  const irisMat = new THREE.PointsMaterial({
    size: 0.04, map: irisTex, color: new THREE.Color('#ffffff'),
    transparent: true, sizeAttenuation: true, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: false,
  });
  const sclera = new THREE.Points(g, scleraMat); sclera.renderOrder = 2;
  const halo = new THREE.Points(g, haloMat); halo.renderOrder = 3;
  const iris = new THREE.Points(g, irisMat); iris.renderOrder = 4;
  const eye = new THREE.Group();
  eye.add(sclera, halo, iris);
  eye.position.set(0, 0, EYE_R); // initial; useFrame re-aims it at the camera each frame
  eye.visible = false;           // reveal shows it once she's formed
  bone.add(eye);
  eyeObjs.push(eye);             // the group: aimed + visibility-gated in useFrame
  return [haloMat];
}
