// Venus ORB v2 — the "CONTAINED STAR" shader pack (docs/studio/VENUS_AVATAR.md, orb v2 section).
// Designed by a 3-lens panel + judge (plasma-star winner, nebula/glass grafts): a churning
// domain-warped photosphere with stellar differential rotation, a see-through counter-rotating
// interior (the volume/parallax read), and two organic gauze veils replacing the wireframe cage.
//
// ES2/expo-gl-safe by construction: precision highp (hash13's fract(p*0.1031) chain underflows
// mediump on device — VENUS_AVATAR.md), FIXED-count loops only, no derivatives, no samplers,
// every pow() base clamped positive, gaussians squared by multiplication. Sampled in unit-sphere
// object space so precision stays unit-scale; uTime rides the scene's t % 600 wrap.

// Shared 3D value-noise toolkit (extends the repo's hash21/vnoise idiom to 3D).
const NOISE3 = /* glsl */ `
float hash13(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float vnoise3(vec3 p){
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z);
}
float fbm2(vec3 p){
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 2; i++){ v += a * vnoise3(p); p = p * 2.02 + 17.0; a *= 0.5; }
  return v;
}
float fbm3(vec3 p){
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++){ v += a * vnoise3(p); p = p * 2.02 + 17.0; a *= 0.5; }
  return v;
}
float fbm4(vec3 p){
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++){ v += a * vnoise3(p); p = p * 2.02 + 17.0; a *= 0.5; }
  return v;
}
mat2 rot2(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
`;

// Shared by plasmaBody (FrontSide) AND interiorBack (BackSide) — ONE source so the two displaced
// silhouettes stay coincident (the "silhouette lock": both materials must receive identical
// uTime/uAmp every frame or the back wall pokes through the front rim as a hard cyan sliver).
export const PLASMA_VERT = /* glsl */ `
precision highp float;
uniform float uTime, uAmp, uFlow;
varying vec3 vN, vV, vObj;
varying float vY;
${NOISE3}
void main(){
  vec3 dir = normalize(position);
  // TWO scales of deformation: big slow LOBES (the whole form visibly morphs — reads as the blob
  // reshaping itself while she talks) + finer convection ripple. uFlow speeds the field on speech.
  vec3 np = dir * 1.6 + vec3(0.0, uTime * uFlow, uTime * uFlow * 0.3);
  float lobe = vnoise3(dir * 0.9 + vec3(uTime * uFlow * 0.5, uTime * 0.07, 0.0));
  float n = fbm3(np);
  float d = ((n - 0.5) * 1.4 + (lobe - 0.5) * 1.2) * uAmp; // uAmp: ~0.05 idle → ~0.3 talking (CPU-clamped)
  vec3 displaced = position * (1.0 + d);
  // forward-difference gradient (dFdx is forbidden) → perturbed shading normal
  float e = 0.12;
  vec3 g = vec3(
    fbm3(np + vec3(e, 0.0, 0.0)) - n,
    fbm3(np + vec3(0.0, e, 0.0)) - n,
    fbm3(np + vec3(0.0, 0.0, e)) - n) / e;
  vec3 gt = g - dir * dot(g, dir);                  // tangential slope only
  vec3 nObj = normalize(dir - gt * uAmp * 4.0);
  vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
  vN = normalize(normalMatrix * nObj);
  vV = normalize(-mv.xyz);
  vObj = dir;
  vY = dir.y * 0.5 + 0.5;                           // 0 bottom → 1 top (thought-pulse axis)
  gl_Position = projectionMatrix * mv;
}
`;

// The MEMBRANE: a translucent glass skin, not a solid photosphere (art direction 2026-07-04:
// "more translucent… it looks like a planet"). The face of the sphere stays nearly CLEAR so the
// neuron network inside reads; the glass lives at the limb — fresnel-weighted wisps, razor rim,
// key-light + counter-glint (the glass tells), thought-pulse band, soft-knee. Drift is BOUNDED
// oscillation (the old unbounded differential spin sheared the noise into planet bands over time).
export const PLASMA_FRAG = /* glsl */ `
precision highp float;
uniform float uTime, uOpacity, uBoil, uSpeak, uTalk, uBlip, uIgnite;
uniform vec3 uCyan, uPlatinum, uNavy, uKeyVS, uFillVS;
varying vec3 vN, vV, vObj;
varying float vY;
${NOISE3}
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);
  float ndv = clamp(dot(N, V), 0.0, 1.0);

  // BOUNDED drift (no accumulating shear): a slow breathing swirl, slightly faster while boiling
  vec3 sp = vObj;
  float swirlA = 0.35 * sin(uTime * 0.05) + uTime * 0.012;
  sp.xz = rot2(swirlA * (0.6 + 0.4 * (1.0 - sp.y * sp.y))) * sp.xz;
  vec3 P = sp * 2.6;

  // PLASMA LICKS: heavier domain warp (boil cranks it) + sharpened crests → tendrils of energy
  // crawling the glass, not an even fog. 2 × fbm2 + 1 × fbm4 = 8 vnoise3.
  float climb = uTime * (0.05 + uBoil * 0.22);
  vec3 q = vec3(
    fbm2(P + vec3(0.0, climb, 0.0)),
    fbm2(P + vec3(5.2, 1.3, 2.8) - vec3(climb * 0.6, 0.0, 0.0)),
    0.0);
  float wisp = fbm4(P + (1.0 + 1.3 * uBoil) * q.xyx);
  float licks = smoothstep(0.48, 0.82, wisp);       // the bright tendril crests

  // the GLASS model: nearly clear face, luminous limb
  float rim   = pow(1.0 - ndv, 2.6);
  float razor = pow(1.0 - ndv, 9.0);
  float faceClear = 0.08 + 0.92 * pow(1.0 - ndv, 1.4); // ≈0.08 at the face → 1 at the limb

  vec3 gauze = mix(uNavy, uCyan, smoothstep(0.3, 0.7, wisp));
  gauze = mix(gauze, uPlatinum, smoothstep(0.7, 0.9, wisp));

  vec3 col = gauze * (0.10 + 0.35 * wisp) * faceClear * (0.7 + uBoil * 0.5);
  // tendrils ride EVERYWHERE (not fresnel-gated) so talking reads as plasma crawling the surface
  col += mix(uCyan, vec3(0.9, 0.98, 1.0), 0.45) * licks * (0.10 + 0.85 * uBoil) * (0.25 + 0.75 * faceClear);
  col += uCyan * rim * 1.15 * uBlip;                // luminous limb
  col += mix(uPlatinum, vec3(1.0), 0.5) * razor * 1.6 * uBlip; // razor edge

  // glass speculars: key light + faint lower-right counter-glint
  vec3 H = normalize(normalize(uKeyVS) + V);
  float dh = max(dot(N, H), 0.001);
  col += vec3(0.83, 0.93, 1.0) * (pow(dh, 90.0) * 0.9 + pow(dh, 8.0) * 0.06);
  vec3 H2 = normalize(normalize(uFillVS) + V);
  float dh2 = max(dot(N, H2), 0.001);
  col += vec3(0.80, 0.92, 1.0) * pow(dh2, 70.0) * 0.25;

  // THOUGHT-PULSE on the glass: same clock + width as the lattice speech wave
  float wavePos = fract(uTime * 0.5);
  float dw = vY - wavePos;
  float band = exp(-dw * dw * 55.0);
  col += mix(uCyan, vec3(0.88, 0.97, 1.0), 0.5) * band * uTalk * (0.3 + 1.0 * uSpeak) * (0.3 + 0.7 * rim);

  col *= 1.0 + 0.7 * uIgnite;                       // ignition flash at the morph landing
  col = col / (1.0 + 0.22 * col);                   // soft knee — additive stack cannot white-clip

  gl_FragColor = vec4(col, uOpacity);
}
`;

// SYNAPSES — the neuron connectors. LineSegments with per-vertex aT (0→1 along each edge) and a
// per-edge phase: a faint constant filament + a bright signal PACKET traveling start→end, looping.
// uRate = firings/sec (speech drives it), uFire = packet brightness. World-Y thought-pulse band
// rides the same clock as the lattice/membrane so the whole brain pulses in one rhythm.
export const NET_VERT = /* glsl */ `
precision highp float;
attribute float aT;
attribute float aPhase;
varying float vT, vPhase, vY;
void main(){
  vT = aT;
  vPhase = aPhase;
  vY = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
export const NET_FRAG = /* glsl */ `
precision highp float;
uniform float uTime, uOpacity, uRate, uFire, uTalk, uSpeak, uOrbR;
uniform vec3 uCyan, uPlatinum;
varying float vT, vPhase, vY;
void main(){
  // the traveling signal packet: position along the edge loops with a per-edge phase offset
  float p = fract(uTime * uRate + vPhase);
  float d = vT - p;
  float packet = exp(-d * d * 90.0);
  // faint ever-present filament, brighter toward edge midpoints (soft ends)
  float ends = vT * (1.0 - vT) * 4.0;
  float filament = 0.16 + 0.22 * ends;
  // bottom→top thought-pulse (same clock as lattice/membrane): -R..R → 0..1
  float y01 = clamp(vY / (2.0 * uOrbR) + 0.5, 0.0, 1.0);
  float wavePos = fract(uTime * 0.5);
  float dw = y01 - wavePos;
  float band = exp(-dw * dw * 55.0) * uTalk;
  vec3 col = mix(uCyan, uPlatinum, 0.25) * filament;
  col += mix(uCyan, vec3(0.92, 0.98, 1.0), 0.6) * packet * uFire;
  col += uCyan * band * (0.3 + 0.9 * uSpeak);
  col = col / (1.0 + 0.25 * col);
  gl_FragColor = vec4(col, uOpacity);
}
`;

// NEURONS — the nodes. Points with per-node phase/size; each node flashes as "its" packet arrives
// (same uRate clock family), and hubs sit brighter. Soft dot sprite comes from uDot.
export const NODE_VERT = /* glsl */ `
precision highp float;
attribute float aPhase;
attribute float aSize;
varying float vPhase;
varying float vYn;
void main(){
  vPhase = aPhase;
  vYn = position.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (1.0 / max(0.1, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;
export const NODE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uDot;
uniform float uTime, uOpacity, uRate, uFire, uTalk, uSpeak, uOrbR;
uniform vec3 uCyan;
varying float vPhase;
varying float vYn;
void main(){
  float a = texture2D(uDot, gl_PointCoord).a;
  // the node flashes when its packet lands (packet arrives at t: fract(uTime*uRate+vPhase)≈1)
  float p = fract(uTime * uRate + vPhase);
  float flash = exp(-(1.0 - p) * (1.0 - p) * 40.0);
  float y01 = clamp(vYn / (2.0 * uOrbR) + 0.5, 0.0, 1.0);
  float wavePos = fract(uTime * 0.5);
  float dw = y01 - wavePos;
  float band = exp(-dw * dw * 55.0) * uTalk;
  float glow = 0.5 + 0.9 * flash * uFire + 0.6 * band * (0.4 + 0.8 * uSpeak);
  vec3 col = mix(uCyan, vec3(0.9, 0.98, 1.0), 0.35 + 0.45 * flash) * glow;
  col = col / (1.0 + 0.25 * col);
  gl_FragColor = vec4(col, a * uOpacity);
}
`;

// The see-through far wall (BackSide, drawn before the front pass): counter-rotates vs the
// surface — the parallax that makes the orb read as a transparent 3D VOLUME, not a decal.
export const INNER_FRAG = /* glsl */ `
precision highp float;
uniform float uTime, uOpacity;
uniform vec3 uCyan, uNavy;
varying vec3 vN, vV, vObj;
${NOISE3}
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);
  // back faces: geometric normals point AWAY from the camera → inverse fresnel on -N
  float f = clamp(dot(-N, V), 0.0, 1.0);
  float depth = pow(f, 2.6);                        // hottest looking straight through the middle
  // counter-rotates vs the front surface → parallax says VOLUME, not decal
  vec3 sp = vObj * 2.2;
  sp.xz = rot2(uTime * -0.07) * sp.xz;
  float swirl = fbm2(sp + vec3(0.0, uTime * 0.05, 0.0));
  vec3 col = mix(uNavy, uCyan, depth) * depth * (0.55 + 0.5 * swirl);
  gl_FragColor = vec4(col, uOpacity * depth);
}
`;

// The gauze veils replacing the wireframe cage: fresnel-gated noise bands at the limb, the two
// shells drifting OPPOSITE ways (rotation happens in-shader on sample coords — meshes never spin).
export const VEIL_VERT = /* glsl */ `
precision highp float;
varying vec3 vN, vV, vObj;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vObj = normalize(position);
  gl_Position = projectionMatrix * mv;
}
`;

export const VEIL_FRAG = /* glsl */ `
precision highp float;
uniform float uTime, uSpin, uOpacity, uFlare;
uniform vec3 uColor;
varying vec3 vN, vV, vObj;
${NOISE3}
void main(){
  float ndv = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  // rotate the SAMPLE coords, not the mesh — the two shells drift opposite ways for free
  vec3 sp = vObj;
  sp.xz = rot2(uTime * uSpin) * sp.xz;
  float veil = fbm2(sp * 4.0 + vec3(0.0, uTime * 0.04, 0.0));
  float band = smoothstep(0.52, 0.80, veil);
  // gauze lives at the limb — fresnel-gated so the face of the orb stays clean
  float a = band * pow(1.0 - ndv, 1.6) * (uOpacity + uFlare);
  gl_FragColor = vec4(uColor, a);
}
`;
