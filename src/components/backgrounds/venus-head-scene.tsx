import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  createVenusLipsync,
  LIPSYNC_MORPHS,
  type VenusLipsync,
  type VisemeWeights,
} from '@/lib/venus-lipsync';

// ── Venus head — "Ascendant Cortana" (R3F) ──────────────────────────────────
// A FEMALE Ready Player Me head rendered as a glowing "plexus" wireframe FACE,
// graded as a Cortana-inspired super-intelligence: a positional aurora duotone
// (cyan→periwinkle→violet by height + grazing normal), a travelling THOUGHT-PULSE
// that sweeps up the mesh like neural activation (you see her think), an inner
// core glow, an aura pool she sits in, and one rare holographic "blip". The face
// stays alive (blink, saccades, brow, sway) and the mouth lip-syncs to REAL audio.
//
// Architecture (keeps it cheap + correct):
//   • DIM morph-driven substrate mesh  → carries lip-sync + blink (constant color)
//   • BRIGHT static glow shell under Head bone → nodes (ShaderMaterial + pulse) +
//     halo + EdgesGeometry + core-glow sphere; built ONCE, shares head sway.
//   • Hair → a faint contour that frames her (no tangle over the face).
// All bloom is additive layering (no postprocessing); GLSL is ES2/expo-gl-safe.
// Web entry for now — the @react-three/fiber/native swap for expo-gl is a later
// step. Demo avatar is CC BY-NC; the user's own licensed RPM Venus swaps via URL.

const AVATAR_URL = 'https://raw.githubusercontent.com/met4citizen/TalkingHead/main/avatars/brunette.glb';
const DEG = Math.PI / 180;

// The 4 morph-rigged meshes that make up the visible face (verified from the GLB).
const FACE_NAMES = ['Wolf3D_Head', 'EyeLeft', 'EyeRight', 'Wolf3D_Teeth'];
// The bright glow SHELL is built from the face SKIN only — eyeballs + teeth stay
// on the dim substrate (cleaner sockets, no bright eye-blobs; structure leads).
const SHELL_NAMES = ['Wolf3D_Head'];

// DEV: play a sample speech clip on load so the mouth moves (and the pulse reacts)
// on web. Set false for production / live Gemini audio. (Guarded to web.)
const DEV_LIPSYNC_TEST = true;
const DEV_SAMPLE_URL = 'https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg';

// ─── shaders (ES2-safe: precision mediump, no #version 300, no dynamic loops) ──
const NODE_VERT = /* glsl */ `
  precision mediump float;
  uniform float uTime, uPeriod, uSpeak;
  attribute float aY;     // baked normalized height 0..1
  attribute float aRand;  // baked per-node phase
  varying vec3 vColor;
  varying float vGlow;
  void main() {
    float wave  = fract(uTime / uPeriod);            // primary jaw->crown wavefront
    float d     = aY - wave;
    float pulse = exp(-d * d * 140.0);               // tight travelling band
    float w2    = fract(uTime / 9.0 + 0.5);          // slow counter-wave (depth)
    pulse += 0.5 * exp(-(aY - w2) * (aY - w2) * 60.0);
    float tw    = 0.9 + 0.1 * sin(uTime * 2.0 + aRand * 6.2831); // tiny twinkle
    vGlow  = (0.5 + (1.5 + uSpeak) * pulse) * tw;    // resting 0.5, subtler crest
    vColor = color;                                  // baked aurora gradient
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(6.0 * vGlow * (1.0 / -mv.z), 3.0, 15.0); // smaller, refined
    gl_Position  = projectionMatrix * mv;
  }
`;
const NODE_FRAG = /* glsl */ `
  precision mediump float;
  uniform sampler2D uDot;
  uniform float uBlip;
  varying vec3 vColor;
  varying float vGlow;
  void main() {
    float a = texture2D(uDot, gl_PointCoord).a;
    gl_FragColor = vec4(vColor * vGlow * uBlip, a);  // additive → brightness = energy
  }
`;
const CORE_VERT = /* glsl */ `
  precision mediump float;
  varying vec3 vN, vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const CORE_FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vN, vV;
  void main() {
    float f = pow(max(dot(vV, vN), 0.0), 2.0);       // bright center, soft edge
    gl_FragColor = vec4(uColor * f, f * uOpacity);
  }
`;

type Rig = {
  meshes: THREE.Mesh[];
  bones: { head?: THREE.Object3D; neck?: THREE.Object3D; leftEye?: THREE.Object3D; rightEye?: THREE.Object3D };
  rest: Map<THREE.Object3D, THREE.Euler>;
  nodeMat?: THREE.ShaderMaterial;
  coreMat?: THREE.ShaderMaterial;
  edgeCoreMat?: THREE.LineBasicMaterial;
  cycleMats: THREE.Material[]; // edges + hair — narrow hue drift
  aura?: THREE.Object3D;       // billboarded aura pool
  shell?: THREE.Group;
};

// Soft round additive sprite — DataTexture (no DOM canvas → native-safe).
function makeDotTexture(): THREE.Texture {
  const size = 64, cx = (size - 1) / 2;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / cx, dy = (y - cx) / cx;
      const a = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
      const v = Math.round(Math.pow(a, 2.2) * 255);
      const i = (y * size + x) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = v;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

// Radial aura gradient (cyan core → indigo → transparent).
function makeAuraTexture(): THREE.Texture {
  const size = 128, cx = (size - 1) / 2;
  const data = new Uint8Array(size * size * 4);
  const inner = new THREE.Color('#3FA6C8'), outer = new THREE.Color('#2E4A8C');
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / cx, dy = (y - cx) / cx;
      const r = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      const col = inner.clone().lerp(outer, r);
      const i = (y * size + x) * 4;
      data[i] = Math.round(col.r * 255);
      data[i + 1] = Math.round(col.g * 255);
      data[i + 2] = Math.round(col.b * 255);
      data[i + 3] = Math.round(Math.pow(Math.max(0, 1 - r), 1.6) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

// Merge named meshes into ONE position-only buffer baked into the head bone's
// local space, so a shell parented to Head registers perfectly and shares sway.
function bakeHeadLocal(scene: THREE.Object3D, head: THREE.Object3D, names: string[]): THREE.BufferGeometry | null {
  scene.updateWorldMatrix(true, true);
  head.updateWorldMatrix(true, true);
  const headInv = new THREE.Matrix4().copy(head.matrixWorld).invert();
  const geos: THREE.BufferGeometry[] = [];
  for (const name of names) {
    const m = scene.getObjectByName(name) as THREE.Mesh | undefined;
    if (!m?.isMesh || !m.geometry) continue;
    const g = m.geometry.clone();
    for (const key of Object.keys(g.attributes)) if (key !== 'position') g.deleteAttribute(key);
    g.morphAttributes = {};
    m.updateWorldMatrix(true, false);
    g.applyMatrix4(m.matrixWorld);
    g.applyMatrix4(headInv);
    geos.push(g);
  }
  if (!geos.length) return null;
  const merged = mergeGeometries(geos, false);
  return merged ? mergeVertices(merged) : null;
}

// Bake the positional aurora gradient + height + per-node phase onto faceGeo.
function bakeAurora(geo: THREE.BufferGeometry) {
  geo.computeVertexNormals();
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const N = pos.count;
  const colA = new Float32Array(N * 3), aY = new Float32Array(N), aRand = new Float32Array(N);
  const bb = new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute);
  const span = Math.max(1e-6, bb.max.y - bb.min.y);
  const cyan = new THREE.Color('#5BD8E6'), peri = new THREE.Color('#7C9BF0');
  const viol = new THREE.Color('#B97CF2'), white = new THREE.Color('#CFF6FF');
  for (let i = 0; i < N; i++) {
    const y = (pos.getY(i) - bb.min.y) / span;
    aY[i] = y;
    aRand[i] = Math.random();
    const nz = Math.abs(nrm.getZ(i)); // 1 = front, 0 = grazing
    const c = cyan.clone();
    if (y > 0.62) c.lerp(viol, THREE.MathUtils.clamp((y - 0.62) / 0.38, 0, 1));
    else if (y > 0.32) c.lerp(peri, (y - 0.32) / 0.3);
    c.lerp(viol, (1 - nz) * 0.5);
    if (y > 0.9) c.lerp(white, (y - 0.9) / 0.1);
    colA[i * 3] = c.r; colA[i * 3 + 1] = c.g; colA[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colA, 3));
  geo.setAttribute('aY', new THREE.BufferAttribute(aY, 1));
  geo.setAttribute('aRand', new THREE.BufferAttribute(aRand, 1));
}

// Subsample a baked buffer (position + color + aY + aRand) at a fixed stride.
function subsample(geo: THREE.BufferGeometry, stride: number): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const col = geo.attributes.color, aY = geo.attributes.aY, aRand = geo.attributes.aRand;
  const n = Math.ceil(pos.count / stride);
  const p = new Float32Array(n * 3);
  const c = col ? new Float32Array(n * 3) : null;
  const y = aY ? new Float32Array(n) : null;
  const rnd = aRand ? new Float32Array(n) : null;
  for (let i = 0, j = 0; i < pos.count; i += stride, j++) {
    p[j * 3] = pos.getX(i); p[j * 3 + 1] = pos.getY(i); p[j * 3 + 2] = pos.getZ(i);
    if (c && col) { c[j * 3] = col.getX(i); c[j * 3 + 1] = col.getY(i); c[j * 3 + 2] = col.getZ(i); }
    if (y && aY) y[j] = aY.getX(i);
    if (rnd && aRand) rnd[j] = aRand.getX(i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  if (c) g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (y) g.setAttribute('aY', new THREE.BufferAttribute(y, 1));
  if (rnd) g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
  return g;
}

function Avatar({ url }: { url: string }) {
  const { camera } = useThree();
  const [root, setRoot] = useState<THREE.Object3D | null>(null);
  const rig = useRef<Rig | null>(null);
  const a = useRef({ nextBlink: 1.2, blinkAt: -1, nextSacc: 0.6, gx: 0, gy: 0, nextBrow: 2.5, browAt: -1, browAmt: 0 });

  // ── lip-sync driver (created once) ────────────────────────────────────────
  const lipRef = useRef<VenusLipsync | null>(null);
  const lipTargets = useRef<VisemeWeights>({});
  if (!lipRef.current) lipRef.current = createVenusLipsync();

  // DEV test harness: an <audio> element playing a sample speech clip (web only).
  useEffect(() => {
    if (!DEV_LIPSYNC_TEST || typeof Audio === 'undefined') return;
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.src = DEV_SAMPLE_URL;
    el.loop = true;
    const start = () => {
      lipRef.current?.resume();
      lipRef.current?.connect(el);
      el.play().catch((e) => console.warn('[venus] sample autoplay blocked; tap to start', e));
    };
    start();
    const onGesture = () => { start(); window.removeEventListener('pointerdown', onGesture); };
    if (typeof window !== 'undefined') window.addEventListener('pointerdown', onGesture);
    return () => {
      el.pause();
      el.src = '';
      if (typeof window !== 'undefined') window.removeEventListener('pointerdown', onGesture);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    new GLTFLoader().load(
      url,
      (gltf) => {
        if (!alive) return;
        const isHair = (n: string) => /hair/i.test(n);
        const isClutter = (n: string) =>
          /hat|headwear|glasses|beard|outfit|shirt|body|hands|bottom|footwear/i.test(n);

        // ── classify + material each mesh ──────────────────────────────────
        // FACE substrate stays in the scene, DIM + additive + CONSTANT color so
        // the mouth still visibly lip-syncs under the bright shell.
        const meshes: THREE.Mesh[] = [];
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const n = m.name || '';
          const isFace = FACE_NAMES.includes(n) || !!m.morphTargetDictionary;
          if (!isFace && (isClutter(n) || isHair(n))) {
            m.visible = false;
            return;
          }
          m.material = new THREE.MeshBasicMaterial({
            color: '#2C5C66',
            wireframe: true,
            transparent: true,
            opacity: 0.12,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          if (m.morphTargetDictionary) meshes.push(m);
        });

        const get = (nm: string) => gltf.scene.getObjectByName(nm) ?? undefined;
        const bones = { head: get('Head'), neck: get('Neck'), leftEye: get('LeftEye'), rightEye: get('RightEye') };
        const rest = new Map<THREE.Object3D, THREE.Euler>();
        Object.values(bones).forEach((b) => b && rest.set(b, b.rotation.clone()));

        // ── build the glowing plexus shell ONCE (bind-pose; off the loop) ───
        const cycleMats: THREE.Material[] = [];
        let shell: THREE.Group | undefined;
        let nodeMat: THREE.ShaderMaterial | undefined;
        let coreMat: THREE.ShaderMaterial | undefined;
        let edgeCoreMat: THREE.LineBasicMaterial | undefined;
        let aura: THREE.Object3D | undefined;

        if (bones.head) {
          const dotTex = makeDotTexture();
          const faceGeo = bakeHeadLocal(gltf.scene, bones.head, SHELL_NAMES);
          if (faceGeo) {
            bakeAurora(faceGeo);
            const dotGeo = subsample(faceGeo, 3); // sparser, more deliberate nodes

            // (a) signature NODES — aurora gradient + travelling thought-pulse
            nodeMat = new THREE.ShaderMaterial({
              uniforms: {
                uTime: { value: 0 },
                uPeriod: { value: 3.5 },
                uSpeak: { value: 0 },
                uBlip: { value: 1 },
                uDot: { value: dotTex },
              },
              vertexShader: NODE_VERT,
              fragmentShader: NODE_FRAG,
              vertexColors: true,
              transparent: true,
              depthTest: true,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
            });
            const corePts = new THREE.Points(dotGeo, nodeMat);

            // (b) node halo — fake bloom, tighter so it reads clean (not washy)
            const glowMat = new THREE.PointsMaterial({
              size: 0.034, map: dotTex, vertexColors: true, opacity: 0.12,
              transparent: true, sizeAttenuation: true,
              blending: THREE.AdditiveBlending, depthWrite: false,
            });
            const glowPts = new THREE.Points(dotGeo, glowMat);

            // (c) structural edges LEAD the look (+ scaled halo clone = fake thickness)
            const edgesGeo = new THREE.EdgesGeometry(faceGeo, 16);
            edgeCoreMat = new THREE.LineBasicMaterial({
              color: new THREE.Color('#3a6f8a'), transparent: true, opacity: 0.36,
              blending: THREE.AdditiveBlending, depthWrite: false,
            });
            const edgeCore = new THREE.LineSegments(edgesGeo, edgeCoreMat);
            const edgeHaloMat = edgeCoreMat.clone();
            edgeHaloMat.opacity = 0.1;
            const edgeHalo = new THREE.LineSegments(edgesGeo, edgeHaloMat);
            edgeHalo.scale.setScalar(1.012);

            // (d) core glow — light from within (fresnel sphere behind the face)
            faceGeo.computeBoundingBox();
            const fc = faceGeo.boundingBox!.getCenter(new THREE.Vector3());
            coreMat = new THREE.ShaderMaterial({
              uniforms: { uColor: { value: new THREE.Color('#3FA6C8') }, uOpacity: { value: 0.9 } },
              vertexShader: CORE_VERT,
              fragmentShader: CORE_FRAG,
              transparent: true,
              depthTest: true,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
            });
            const coreSphere = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 2), coreMat);
            coreSphere.position.set(fc.x, fc.y, fc.z - 0.03);
            coreSphere.renderOrder = 0;

            shell = new THREE.Group();
            shell.add(coreSphere, edgeHalo, glowPts, edgeCore, corePts); // back→front
            shell.renderOrder = 2;

            // (e) faint hair contour — frames her as female without tangling
            const hairGeo = bakeHeadLocal(gltf.scene, bones.head, ['Wolf3D_Hair']);
            if (hairGeo) {
              const hairEdges = new THREE.EdgesGeometry(hairGeo, 32);
              const hairMat = new THREE.LineBasicMaterial({
                color: new THREE.Color('#2f5560'), transparent: true, opacity: 0.16,
                blending: THREE.AdditiveBlending, depthWrite: false,
              });
              hairMat.opacity = 0.12; // restrained — a whisper of a frame
              const hairHalo = new THREE.LineSegments(hairEdges, hairMat);
              hairHalo.renderOrder = 1;
              shell.add(hairHalo);
              cycleMats.push(hairMat);
            }

            bones.head.add(shell);
            cycleMats.push(edgeCoreMat, edgeHaloMat);

            // (f) aura pool — she sits in her own light (billboarded, behind head)
            const auraMat = new THREE.MeshBasicMaterial({
              map: makeAuraTexture(), transparent: true, opacity: 0.1,
              blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
            });
            aura = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), auraMat);
            const hw = new THREE.Vector3();
            bones.head.getWorldPosition(hw);
            aura.position.set(hw.x, hw.y - 0.05, hw.z - 0.3);
            aura.scale.setScalar(0.95);
            aura.renderOrder = -1;
          }
        }

        rig.current = { meshes, bones, rest, nodeMat, coreMat, edgeCoreMat, cycleMats, aura, shell };

        // frame the face off the known avatar scale (head at the top, face at +z).
        // NOTE: frame BEFORE adding the aura plane — it would inflate the bbox.
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const aimY = box.max.y - 0.24;
        camera.position.set(0, aimY, 1.0);
        camera.lookAt(0, aimY, 0);
        camera.updateProjectionMatrix();
        if (aura) gltf.scene.add(aura);
        setRoot(gltf.scene);
      },
      undefined,
      (e) => console.error('[venus] GLTF load error', e),
    );
    return () => {
      alive = false;
    };
  }, [url, camera]);

  useFrame((st, delta) => {
    const r = rig.current;
    if (!r) return;
    const t = st.clock.elapsedTime % 600; // modulo guard for mediump precision
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

    // ── narrow hue drift (cyan→violet arc, ±14°, ~28s) — EDGES + hair only ──
    const h = 0.52 + 0.04 * Math.sin(t * 0.045);
    for (const m of r.cycleMats) (m as THREE.LineBasicMaterial).color?.setHSL(h, 0.5, 0.55);

    // ── rare holographic blip (the ONE instability) ────────────────────────
    const blip = Math.random() < 0.003 ? 0.82 : 1.0;
    if (r.edgeCoreMat) r.edgeCoreMat.opacity = 0.36 * blip;

    // ── node uniforms: thought-pulse time + reactive speak energy + blip ────
    const speak = lipTargets.current.jawOpen ?? 0;
    if (r.nodeMat) {
      const u = r.nodeMat.uniforms;
      u.uTime.value = t;
      u.uBlip.value = blip;
      u.uSpeak.value = THREE.MathUtils.damp(u.uSpeak.value, speak * 1.2, 8, delta);
      u.uPeriod.value = THREE.MathUtils.damp(u.uPeriod.value, speak > 0.06 ? 1.4 : 3.5, 4, delta);
    }
    if (r.coreMat) r.coreMat.uniforms.uOpacity.value = 0.5 + 0.1 * Math.sin(t * 0.5);

    // ── shell parallax + aura billboard/breath ─────────────────────────────
    if (r.shell) {
      r.shell.rotation.y = Math.sin(t * 0.18) * 0.05;
      r.shell.position.y = Math.sin(t * 0.5) * 0.003;
    }
    if (r.aura) {
      r.aura.quaternion.copy(camera.quaternion);
      r.aura.scale.setScalar(0.95 * (1 + 0.03 * Math.sin(t * 0.25)));
    }

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

    // ── REAL audio → visemes (lip-sync owns ONLY jaw/mouth/viseme morphs) ───
    const lip = lipRef.current;
    if (lip) {
      const targets = lip.sample();
      lipTargets.current = targets;
      for (const name of LIPSYNC_MORPHS) {
        for (const m of r.meshes) {
          const i = m.morphTargetDictionary?.[name];
          if (i === undefined || !m.morphTargetInfluences) continue;
          const target = targets[name] ?? 0;
          const cur = m.morphTargetInfluences[i];
          const isJaw = name === 'jawOpen' || name === 'mouthOpen' || name === 'mouthClose';
          const lambda = isJaw ? 16 : target > 0 ? 14 : 12;
          m.morphTargetInfluences[i] = THREE.MathUtils.damp(cur, target, lambda, delta);
        }
      }
    }
  });

  return root ? <primitive object={root} /> : null;
}

export default function VenusHeadScene() {
  return (
    <Canvas camera={{ position: [0, 0, 2], fov: 22 }} style={{ flex: 1 }}>
      <color attach="background" args={['#06080f']} />
      <Avatar url={AVATAR_URL} />
    </Canvas>
  );
}
