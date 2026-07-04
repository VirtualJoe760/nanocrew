// Venus ORB v3 — the "NEURAL CONSTELLATION" shader pack (docs/studio/VENUS_AVATAR.md).
// Designed by a 3-lens panel + judge (2026-07-04, "get away from it looking like an orb…
// really we want a visual representation of a neural network… way more detail"): every
// spherical surface is gone; the network IS the object. An irregular ganglia cloud of
// somas wired by curved dendrites, braided trunk axons, whisker fuzz and a dim long-range
// web, all rooted into a white-hot plasma-sheathed nucleus (the ONLY surviving plasma).
//
// ES2/expo-gl-safe by construction: precision highp (hash13's fract(p*0.1031) chain underflows
// mediump on device — VENUS_AVATAR.md), FIXED-count loops only, no derivatives, no samplers
// except the dot sprite, every pow() base clamped positive. Sampled in unit-sphere object space
// so precision stays unit-scale; uTime rides the scene's t % 600 wrap.

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
mat2 rot2(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
`;

// The displaced-blob vertex pass — now worn ONLY by the nucleus SHEATH (0.30R). Two scales of
// deformation: big slow LOBES (the sheath visibly reshapes while she talks) + finer convection
// ripple; uFlow speeds the field on speech. Forward-difference gradient (dFdx forbidden).
export const PLASMA_VERT = /* glsl */ `
precision highp float;
uniform float uTime, uAmp, uFlow;
varying vec3 vN, vV, vObj;
varying float vY;
${NOISE3}
void main(){
  vec3 dir = normalize(position);
  vec3 np = dir * 1.6 + vec3(0.0, uTime * uFlow, uTime * uFlow * 0.3);
  float lobe = vnoise3(dir * 0.9 + vec3(uTime * uFlow * 0.5, uTime * 0.07, 0.0));
  float n = fbm3(np);
  float d = ((n - 0.5) * 1.4 + (lobe - 0.5) * 1.2) * uAmp;
  vec3 displaced = position * (1.0 + d);
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
  vY = dir.y * 0.5 + 0.5;
  gl_Position = projectionMatrix * mv;
}
`;

// The nucleus SHEATH — the old membrane slimmed to a small boiling corona around the core.
// vs the old PLASMA_FRAG: thought-pulse band gone, both glass speculars gone (glass tells are
// sphere tells), wisp warp fbm3 not fbm4, razor weight halved (soft corona edge, not a glass rim).
export const SHEATH_FRAG = /* glsl */ `
precision highp float;
uniform float uTime, uOpacity, uBoil, uBlip, uIgnite;
uniform vec3 uCyan, uPlatinum, uNavy;
varying vec3 vN, vV, vObj;
${NOISE3}
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);
  float ndv = clamp(dot(N, V), 0.0, 1.0);

  // BOUNDED drift (no accumulating shear): a slow breathing swirl, faster while boiling
  vec3 sp = vObj;
  float swirlA = 0.35 * sin(uTime * 0.05) + uTime * 0.012;
  sp.xz = rot2(swirlA * (0.6 + 0.4 * (1.0 - sp.y * sp.y))) * sp.xz;
  vec3 P = sp * 2.6;

  // PLASMA LICKS: domain warp (boil cranks it) + sharpened crests → tendrils crawling the corona
  float climb = uTime * (0.05 + uBoil * 0.22);
  vec3 q = vec3(
    fbm2(P + vec3(0.0, climb, 0.0)),
    fbm2(P + vec3(5.2, 1.3, 2.8) - vec3(climb * 0.6, 0.0, 0.0)),
    0.0);
  float wisp = fbm3(P + (1.0 + 1.3 * uBoil) * q.xyx);
  float licks = smoothstep(0.48, 0.82, wisp);

  float rim   = pow(1.0 - ndv, 2.6);
  float razor = pow(1.0 - ndv, 9.0);
  float faceClear = 0.08 + 0.92 * pow(1.0 - ndv, 1.4);

  vec3 gauze = mix(uNavy, uCyan, smoothstep(0.3, 0.7, wisp));
  gauze = mix(gauze, uPlatinum, smoothstep(0.7, 0.9, wisp));

  vec3 col = gauze * (0.10 + 0.35 * wisp) * faceClear * (0.7 + uBoil * 0.5);
  col += mix(uCyan, vec3(0.9, 0.98, 1.0), 0.45) * licks * (0.10 + 0.85 * uBoil) * (0.25 + 0.75 * faceClear);
  col += uCyan * rim * 1.15 * uBlip;
  col += mix(uPlatinum, vec3(1.0), 0.5) * razor * 0.8 * uBlip;

  col *= 1.0 + 0.7 * uIgnite;                       // ignition flash at the morph landing
  col = col / (1.0 + 0.22 * col);                   // soft knee — additive stack cannot white-clip
  gl_FragColor = vec4(col, uOpacity);
}
`;

// THE NUCLEUS — hero core: inverse fresnel (hot heart) + a 2-tap noise mottle so close-ups
// aren't a flat gradient; uFlare rides syllables and the morph-landing ignition.
export const NUCLEUS_VERT = /* glsl */ `
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
export const NUCLEUS_FRAG = /* glsl */ `
precision highp float;
uniform float uTime, uOpacity, uFlare;
uniform vec3 uCyan;
varying vec3 vN, vV, vObj;
${NOISE3}
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);
  float f = pow(clamp(dot(N, V), 0.001, 1.0), 2.2);   // inverse fresnel — hot heart
  float m = fbm2(vObj * 3.0 + vec3(uTime * 0.10, uTime * 0.06, 0.0));
  vec3 col = mix(uCyan, vec3(0.94, 0.99, 1.0), f) * (0.45 + 1.25 * f) * (0.85 + 0.3 * m);
  col *= 1.0 + uFlare;
  col = col / (1.0 + 0.22 * col);
  gl_FragColor = vec4(col, f * uOpacity);
}
`;

// THE WIRING — one merged LineSegments buffer, four classes telling one story:
//   aClass 0 = fine long-range web (dim gauze, the volume fill)
//   aClass 1 = dendrites (curved intra-ganglion arcs — the main tissue)
//   aClass 2 = trunk axons (braided 3-strand bundles between hubs + into the nucleus)
//   aClass 3 = whisker fuzz (tip-tapered stubs off every soma — the fine detail)
// Signal packets travel aT 0→1 per path on a per-ganglion staggered clock; a comet tail and a
// refractory dim trail behind them; trunks run a second offset packet. aGrow gates the assembly:
// the network wires itself OUTWARD from the nucleus as uGrow sweeps 0→1.
export const NET_VERT = /* glsl */ `
precision highp float;
attribute float aT, aPhase, aClass, aGang, aBright, aGrow;
attribute vec3 aJit;
uniform float uTime, uJitAmp, uOrbR;
varying float vT, vPhase, vClass, vGang, vBright, vGrow, vWy, vDepth;
void main(){
  vT = aT; vPhase = aPhase; vClass = aClass; vGang = aGang; vBright = aBright; vGrow = aGrow;
  // living-wire shimmer — the whole web trembles, amplitude rides speech (uJitAmp)
  vec3 p = position + aJit * uOrbR * 0.004 * uJitAmp
           * sin(uTime * 1.3 + aPhase * 6.2831 + aT * 9.0);
  vWy = (modelMatrix * vec4(p, 1.0)).y;              // WORLD y — the band stays vertical under sway
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDepth = clamp((-mv.z - 1.80) / 0.42, 0.0, 1.0);   // 0 near → 1 far across the ACTUAL cloud z-extent
  gl_Position = projectionMatrix * mv;
}
`;
export const NET_FRAG = /* glsl */ `
precision highp float;
uniform float uTime, uOpacity, uRate, uFire, uTalk, uSpeak, uGrow, uIgnite, uTrunk;
uniform float uHotGang, uGangFlare, uYMin, uYSpan;
uniform vec3 uCyan, uPlatinum;
varying float vT, vPhase, vClass, vGang, vBright, vGrow, vWy, vDepth;
void main(){
  float isFine  = 1.0 - step(0.5, vClass);
  float isDend  = step(0.5, vClass) * (1.0 - step(1.5, vClass));
  float isTrunk = step(1.5, vClass) * (1.0 - step(2.5, vClass));
  float isWhisk = step(2.5, vClass);
  // packets: per-ganglion staggered clock; trunks slower; whiskers never fire
  float rate = uRate * (0.8 + 0.4 * fract(vGang * 0.37)) * (isDend + 0.55 * isTrunk + 0.8 * isFine);
  float p = fract(uTime * rate + vPhase);
  float K = 130.0 - 60.0 * uSpeak;                   // the packet WIDENS + brightens on speech
  float d = vT - p;
  float head = exp(-d * d * K);
  float tail = 0.35 * exp(-abs(d) * 20.0) * (1.0 - step(0.0, d));   // comet wake
  float d2 = vT - fract(p + 0.5);
  float head2 = 0.45 * exp(-d2 * d2 * K) * isTrunk;                 // trunk double packet
  float pk = (head + tail + head2) * (1.0 - isWhisk);
  float refr = 0.45 + 0.55 * smoothstep(0.05, 0.35, fract(p - vT)); // refractory dim trail
  // the filament ladder — a 4-tier brightness hierarchy IS the perceived detail
  float ends = vT * (1.0 - vT) * 4.0;
  float fil = isFine  * (0.045 + 0.05 * ends)
            + isDend  * (0.14 + 0.20 * ends)
            + isTrunk * (0.30 + 0.20 * ends) * (1.0 + 1.2 * uTrunk)
            + isWhisk * 0.10 * (1.0 - vT);                          // tip taper
  fil *= vBright * refr;
  float gangHit = 1.0 - min(abs(vGang - uHotGang), 1.0);            // idle thought-flare
  fil *= 1.0 + 0.8 * uGangFlare * gangHit;
  // bottom→top thought band — SAME clock/width as the lattice, on WORLD y
  float y01 = clamp((vWy - uYMin) / uYSpan, 0.0, 1.0);
  float dw = y01 - fract(uTime * 0.5);
  float band = exp(-dw * dw * 55.0) * uTalk;
  vec3 col = mix(uCyan * 0.55, uCyan, isDend + isTrunk + isWhisk) * fil;
  col = mix(col, mix(uCyan, uPlatinum, 0.45), isTrunk * 0.9);       // trunks platinum-hot
  col += mix(uCyan, vec3(0.92, 0.98, 1.0), 0.5 + 0.3 * isTrunk)
         * pk * uFire * (1.0 + 1.5 * uIgnite) * (isDend + 1.4 * isTrunk + 0.25 * isFine);
  col += uCyan * band * (0.3 + 0.9 * uSpeak) * (isDend + isTrunk);
  col *= mix(0.45, 1.0, 1.0 - vDepth);                              // depth cue — the #1 3D tell
  col *= smoothstep(vGrow - 0.15, vGrow, uGrow);                    // wires outward from the nucleus
  col = col / (1.0 + 0.25 * col);
  gl_FragColor = vec4(col, uOpacity * (0.5 * isFine + (1.0 - isFine)));
}
`;

// THE SOMAS — procedural two-gaussian sprite (hot core + haze halo reads as a cell body, not a
// flat dot). Flash when "their" packet lands (same staggered clock family as NET), breathe at
// idle, ride the talking band + ganglion thought-flare, and grow in with aGrow.
export const NODE_VERT = /* glsl */ `
precision highp float;
attribute float aPhase, aSize, aGang, aHub, aGrow;
uniform float uTime;
varying float vPhase, vGang, vHub, vGrow, vWy, vDepth;
void main(){
  vPhase = aPhase; vGang = aGang; vHub = aHub; vGrow = aGrow;
  vWy = (modelMatrix * vec4(position, 1.0)).y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = clamp((-mv.z - 1.80) / 0.42, 0.0, 1.0);
  float breathe = 1.0 + 0.12 * sin(uTime * 0.8 + aPhase * 6.2831);
  gl_PointSize = clamp(aSize * breathe * (1.0 / max(0.1, -mv.z)), 2.0, 30.0);
  gl_Position = projectionMatrix * mv;
}
`;
export const NODE_FRAG = /* glsl */ `
precision highp float;
uniform float uTime, uOpacity, uRate, uFire, uTalk, uSpeak, uGrow;
uniform float uHotGang, uGangFlare, uYMin, uYSpan;
uniform vec3 uCyan, uPlatinum;
varying float vPhase, vGang, vHub, vGrow, vWy, vDepth;
void main(){
  vec2 pc = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(pc, pc);
  float core = exp(-r2 * 22.0);
  float halo = 0.5 * exp(-r2 * 5.0);
  float p = fract(uTime * uRate * (0.8 + 0.4 * fract(vGang * 0.37)) + vPhase);
  float flash = exp(-(1.0 - p) * (1.0 - p) * 40.0);
  float y01 = clamp((vWy - uYMin) / uYSpan, 0.0, 1.0);
  float dw = y01 - fract(uTime * 0.5);
  float band = exp(-dw * dw * 55.0) * uTalk;
  float gangHit = 1.0 - min(abs(vGang - uHotGang), 1.0);
  float glow = (0.45 + 0.9 * flash * uFire + 0.6 * band * (0.4 + 0.8 * uSpeak) + 0.35 * vHub)
             * (1.0 + 0.8 * uGangFlare * gangHit);
  vec3 col = mix(mix(uCyan, uPlatinum, 0.4 * vHub), vec3(0.92, 0.98, 1.0), 0.35 + 0.45 * flash)
           * glow * (core + halo);
  col *= mix(0.5, 1.0, 1.0 - vDepth);
  col *= smoothstep(vGrow - 0.10, vGrow, uGrow);
  col = col / (1.0 + 0.25 * col);
  gl_FragColor = vec4(col, clamp(core + halo, 0.0, 1.0) * uOpacity);
}
`;

// GHOST DUST — 400 near-invisible motes filling the interstitial volume (with the fine web,
// this replaces the deleted veils' depth). Slow independent twinkle, nothing else.
export const DUST_VERT = /* glsl */ `
precision highp float;
attribute float aPhase;
varying float vPhase;
void main(){
  vPhase = aPhase;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = 5.0 / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;
export const DUST_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uDot;
uniform float uTime, uOpacity;
uniform vec3 uCyan;
varying float vPhase;
void main(){
  float a = texture2D(uDot, gl_PointCoord).a;
  float tw = 0.35 + 0.25 * sin(uTime * 0.4 + vPhase * 6.2831);
  gl_FragColor = vec4(uCyan * 0.35, a * tw * uOpacity);
}
`;
