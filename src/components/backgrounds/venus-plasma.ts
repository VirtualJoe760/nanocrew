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
uniform float uTime, uOpacity, uBoil, uBlip, uIgnite, uColMix, uBeatPop, uVoice;
uniform vec3 uColA, uColB, uPlatinum, uNavy;
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

  // the sheath rides the nucleus-family hue clock; the wisps themselves shade across the palette
  vec3 shCol = mix(uColA, uColB, 0.5 - 0.5 * cos(6.2831 * (uColMix + wisp * 0.3 + 0.3 * uVoice)));
  vec3 gauze = mix(uNavy, shCol, smoothstep(0.3, 0.7, wisp));
  gauze = mix(gauze, uPlatinum, smoothstep(0.7, 0.9, wisp));

  vec3 col = gauze * (0.10 + 0.35 * wisp) * faceClear * (0.7 + uBoil * 0.5);
  col += mix(shCol, vec3(0.9, 0.98, 1.0), 0.45) * licks * (0.10 + 0.85 * uBoil) * (0.25 + 0.75 * faceClear);
  col += shCol * rim * 1.15 * uBlip;
  col += mix(uPlatinum, vec3(1.0), 0.5) * razor * 0.8 * uBlip;

  col *= (1.0 + 0.7 * uIgnite) * (1.0 + 0.15 * uBeatPop) * (1.0 + 0.3 * uVoice);
  col = col / (1.0 + 0.22 * col);                   // soft knee — additive stack cannot white-clip
  gl_FragColor = vec4(col, uOpacity);
}
`;

// THE NUCLEUS — hero core: NOT a sphere. Terraced (quantized) noise displacement = crystal
// facets that reform as the field flows, a second free-flowing swell so the shapes move in
// different ways, and a fine per-facet tremor — "crystallized water vibrating" (art direction).
// Forward-difference normals so the fresnel breaks into facet glints.
export const NUCLEUS_VERT = /* glsl */ `
precision highp float;
uniform float uTime;
varying vec3 vN, vV, vObj;
${NOISE3}
void main(){
  vec3 dir = normalize(position);
  vec3 nc = dir * 2.2 + vec3(uTime * 0.11, uTime * 0.07, 0.0);
  float n = vnoise3(nc);
  float n2 = vnoise3(dir * 4.5 - vec3(0.0, uTime * 0.13, uTime * 0.05));
  float facet = mix(n, floor(n * 4.0) / 4.0 + 0.125, 0.7);
  float d = (facet - 0.5) * 0.55 + (n2 - 0.5) * 0.18
          + 0.025 * sin(uTime * 9.0 + hash13(floor(dir * 5.0)) * 6.2831);
  vec3 displaced = position * (1.0 + d);
  float e = 0.15;
  vec3 g = vec3(
    vnoise3(nc + vec3(e * 2.2, 0.0, 0.0)) - n,
    vnoise3(nc + vec3(0.0, e * 2.2, 0.0)) - n,
    vnoise3(nc + vec3(0.0, 0.0, e * 2.2)) - n) / e;
  vec3 gt = g - dir * dot(g, dir);
  vec3 nObj = normalize(dir - gt * 1.2);
  vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
  vN = normalize(normalMatrix * nObj);
  vV = normalize(-mv.xyz);
  vObj = dir;
  gl_Position = projectionMatrix * mv;
}
`;
export const NUCLEUS_FRAG = /* glsl */ `
precision highp float;
uniform float uTime, uOpacity, uFlare, uColMix, uBeatPop, uVoice;
uniform vec3 uColA, uColB;
varying vec3 vN, vV, vObj;
${NOISE3}
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);
  float f = pow(clamp(dot(N, V), 0.001, 1.0), 2.2);   // inverse fresnel — hot heart
  float m = fbm2(vObj * 3.0 + vec3(uTime * 0.10, uTime * 0.06, 0.0));
  // the crystal wears its palette per-facet (the mottle shifts the hue plate to plate) and the
  // whole family slides on the nucleus hue clock; edges glint like cut crystal.
  vec3 nucCol = mix(uColA, uColB, 0.5 - 0.5 * cos(6.2831 * (uColMix + m * 0.45 + 0.3 * uVoice)));
  vec3 col = mix(nucCol, vec3(0.97, 0.99, 1.0), f) * (0.45 + 1.25 * f) * (0.85 + 0.3 * m);
  float edge = pow(clamp(1.0 - dot(N, V), 0.001, 1.0), 3.0);
  col += nucCol * edge * 0.5;
  col = mix(col, vec3(1.0, 0.99, 1.0), 0.3 * clamp(uVoice, 0.0, 1.0)); // white-hot with the voice
  col *= (1.0 + uFlare) * (1.0 + 0.25 * uBeatPop);
  col = col / (1.0 + 0.22 * col);
  gl_FragColor = vec4(col, max(f, edge * 0.5) * uOpacity);
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
uniform float uTime, uJitAmp, uOrbR, uExpand;
varying float vT, vPhase, vClass, vGang, vBright, vGrow, vWy, vDepth;
void main(){
  vT = aT; vPhase = aPhase; vClass = aClass; vGang = aGang; vBright = aBright; vGrow = aGrow;
  // CRAWL — slow two-frequency waves traveling ALONG each wire (aT-coupled phase): the limbs
  // visibly snake, anchored at their endpoints so wires never detach from somas; whisker TIPS
  // swing free. Amplitude rides speech (uJitAmp); trunks stay stiff, whiskers loose.
  float isWhisk = step(2.5, aClass);
  float isTrunk = step(1.5, aClass) * (1.0 - isWhisk);
  float loose = mix(mix(1.0, 0.35, isTrunk), 1.5, isWhisk);
  float anchor = mix(min(1.0, aT * (1.0 - aT) * 4.0), aT, isWhisk);
  vec3 crawl = aJit * sin(aT * 6.2831 - uTime * 0.55 + aPhase * 6.2831)
             + aJit.zxy * 0.6 * sin(aT * 12.566 + uTime * 0.37 + aPhase * 12.0);
  vec3 p = position + crawl * (uOrbR * 0.011 * loose * anchor * uJitAmp);
  // differential EXPANSION — the net grows outward: roots stay anchored (aGrow≈0), the
  // periphery breathes off the frame (aGrow≈1). Slow clock, no ring read.
  p += normalize(position + vec3(1e-5)) * (uOrbR * uExpand * aGrow);
  vWy = (modelMatrix * vec4(p, 1.0)).y;              // WORLD y — the band stays vertical under sway
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDepth = clamp((-mv.z - 1.45) / 1.1, 0.0, 1.0);   // 0 near → 1 far across the ACTUAL cloud z-extent
  gl_Position = projectionMatrix * mv;
}
`;
export const NET_FRAG = /* glsl */ `
precision highp float;
uniform float uTime, uOpacity, uRate, uFire, uTalk, uSpeak, uGrow, uIgnite, uTrunk;
uniform float uHotGang, uGangFlare, uYMin, uYSpan, uCrawlPos;
uniform float uColMix, uLimMix, uBeatPop, uVoice;
uniform vec3 uColA, uColB, uLimA, uLimB;
varying float vT, vPhase, vClass, vGang, vBright, vGrow, vWy, vDepth;
void main(){
  float isFine  = 1.0 - step(0.5, vClass);
  float isDend  = step(0.5, vClass) * (1.0 - step(1.5, vClass));
  float isTrunk = step(1.5, vClass) * (1.0 - step(2.5, vClass));
  float isWhisk = step(2.5, vClass);
  // packets: per-ganglion staggered clock; whiskers never fire; trunks carry SNAKES instead
  float rate = uRate * (0.8 + 0.4 * fract(vGang * 0.37)) * (isDend + 0.8 * isFine);
  float p = fract(uTime * rate + vPhase);
  float K = 130.0 - 60.0 * uSpeak;                   // the packet WIDENS + brightens on speech
  float d = vT - p;
  float head = exp(-d * d * K);
  float tail = 0.35 * exp(-abs(d) * 20.0) * (1.0 - step(0.0, d));   // comet wake
  float pk = (head + tail) * (1.0 - isWhisk) * (1.0 - isTrunk);
  // ELECTRICITY — fast intermittent sparks racing the circuits (dendrites + fine web): each
  // wire bursts ~30% of the time, discharge crossing in well under a second.
  float sp = vT - fract(uTime * uRate * 7.0 + vPhase * 7.31);
  float burst = step(0.72, fract(vPhase * 13.7 + uTime * 0.23));
  float spark = exp(-sp * sp * 420.0) * burst * (isDend + 0.7 * isFine);
  float refr = 0.45 + 0.55 * smoothstep(0.05, 0.35, fract(p - vT)); // refractory dim trail
  refr = mix(refr, 1.0, isTrunk);
  // LIMBIC SNAKES — each braided trunk is a living body sliding around the nucleus: a hot head,
  // a tapered tail, the body length breathing as it travels ("snake", per the art direction).
  float hp = fract(uTime * uRate * 0.6 + vPhase);
  float db = fract(hp - vT);
  float bodyLen = 0.38 + 0.14 * sin(uTime * 0.31 + vPhase * 6.2831);
  float body = max(0.0, 1.0 - db / bodyLen);
  float snake = exp(-db * db * 300.0) * 1.3 + body * body * 0.9;
  // the filament ladder — a 4-tier brightness hierarchy IS the perceived detail
  float ends = vT * (1.0 - vT) * 4.0;
  float fil = isFine  * (0.045 + 0.05 * ends)
            + isDend  * (0.14 + 0.20 * ends)
            + isTrunk * (0.05 + 0.05 * ends + snake * (0.55 + 0.5 * uTrunk))
            + isWhisk * 0.10 * (1.0 - vT);                          // tip taper
  fil *= vBright * refr;
  float gangHit = 1.0 - min(abs(vGang - uHotGang), 1.0);            // idle thought-flare
  fil *= 1.0 + 0.8 * uGangFlare * gangHit;
  // bottom→top thought band — SAME clock/width as the lattice, on WORLD y
  float y01 = clamp((vWy - uYMin) / uYSpan, 0.0, 1.0);
  float dw = y01 - fract(uTime * 0.5);
  float band = exp(-dw * dw * 55.0) * uTalk;
  // independent part palettes on the 80bpm hue clocks: the NET's gradient flows outward along
  // the growth field; each LIMBIC snake wears its palette along its own body (vT). The old
  // flat trunk-color mix also buried the fil/snake modulation — colors now multiply fil.
  vec3 netCol = mix(uColA, uColB, 0.5 - 0.5 * cos(6.2831 * (uColMix + vGrow * 0.35 + 0.2 * uVoice)));
  vec3 limCol = mix(uLimA, uLimB, 0.5 - 0.5 * cos(6.2831 * (uLimMix + vT + 0.25 * uVoice)));
  vec3 wire = mix(netCol * 0.55, netCol, isDend + isTrunk + isWhisk);
  wire = mix(wire, limCol, isTrunk);
  vec3 col = wire * fil;
  col += mix(mix(netCol, limCol, isTrunk), vec3(0.92, 0.98, 1.0), 0.5 + 0.3 * isTrunk)
         * (pk + spark * 0.9) * uFire * (1.0 + 1.5 * uIgnite) * (isDend + 1.4 * isTrunk + 0.4 * isFine);
  col += netCol * band * (0.3 + 0.9 * uSpeak) * (isDend + isTrunk);
  col *= mix(0.45, 1.0, 1.0 - vDepth);                              // depth cue — the #1 3D tell
  // ENERGY CRAWL — a sharp luminous front pulsing down the ROOTS along the BFS growth field
  // (graph paths from the nucleus to the arm tips — not radius, so it never reads as a ring)
  float dcr = abs(vGrow - uCrawlPos);
  dcr = min(dcr, 1.0 - dcr);
  col *= 1.0 + 0.55 * exp(-dcr * dcr * 130.0);
  col *= (1.0 + 0.2 * uBeatPop) * (1.0 + 0.35 * uVoice);              // 80bpm pop + the voice surge
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
uniform float uTime, uOrbR, uExpand;
varying float vPhase, vGang, vHub, vGrow, vWy, vDepth;
void main(){
  vPhase = aPhase; vGang = aGang; vHub = aHub; vGrow = aGrow;
  // cells ride the same differential expansion as their wires (roots anchored, periphery out)
  vec3 p = position + normalize(position + vec3(1e-5)) * (uOrbR * uExpand * aGrow);
  vWy = (modelMatrix * vec4(p, 1.0)).y;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDepth = clamp((-mv.z - 1.45) / 1.1, 0.0, 1.0);
  float breathe = 1.0 + 0.12 * sin(uTime * 0.8 + aPhase * 6.2831);
  gl_PointSize = clamp(aSize * breathe * (1.0 / max(0.1, -mv.z)), 2.0, 30.0);
  gl_Position = projectionMatrix * mv;
}
`;
export const NODE_FRAG = /* glsl */ `
precision highp float;
uniform float uTime, uOpacity, uRate, uFire, uTalk, uSpeak, uGrow;
uniform float uHotGang, uGangFlare, uYMin, uYSpan, uCrawlPos;
uniform float uColMix, uBeatPop, uVoice;
uniform vec3 uColA, uColB, uPlatinum;
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
  // cells wear the NET palette (same clock/gradient as their wires); hubs tint platinum
  vec3 netCol = mix(uColA, uColB, 0.5 - 0.5 * cos(6.2831 * (uColMix + vGrow * 0.35 + 0.2 * uVoice)));
  vec3 col = mix(mix(netCol, uPlatinum, 0.4 * vHub), vec3(0.92, 0.98, 1.0), 0.35 + 0.45 * flash)
           * glow * (core + halo);
  col *= mix(0.5, 1.0, 1.0 - vDepth);
  // the energy crawl lights each cell as the front creeps past (same field as the wiring)
  float dcr = abs(vGrow - uCrawlPos);
  dcr = min(dcr, 1.0 - dcr);
  col *= 1.0 + 0.45 * exp(-dcr * dcr * 60.0);
  col *= (1.0 + 0.25 * uBeatPop) * (1.0 + 0.4 * uVoice);              // 80bpm pop + the voice surge
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
uniform float uTime, uOrbR, uExpand;
varying float vPhase;
void main(){
  vPhase = aPhase;
  // the motes are free-floating (not dot-morph-coupled): a slow interstitial orbit + radial bob,
  // drifting outward with the net's expansion (weighted by their own radius)
  vec3 p = position;
  float ca = cos(uTime * 0.03), sa = sin(uTime * 0.03);
  p.xz = mat2(ca, -sa, sa, ca) * p.xz;
  p += normalize(p + vec3(1e-5)) * (uOrbR * 0.012 * sin(uTime * 0.3 + aPhase * 6.2831));
  p += normalize(p + vec3(1e-5)) * (uOrbR * uExpand * clamp(length(position) / (1.2 * uOrbR), 0.0, 1.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = 5.0 / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;
export const DUST_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uDot;
uniform float uTime, uOpacity, uColMix, uBeatPop, uVoice;
uniform vec3 uColA, uColB;
varying float vPhase;
void main(){
  float a = texture2D(uDot, gl_PointCoord).a;
  float tw = 0.35 + 0.25 * sin(uTime * 0.4 + vPhase * 6.2831);
  vec3 c = mix(uColA, uColB, 0.5 - 0.5 * cos(6.2831 * (uColMix + vPhase * 0.3 + 0.2 * uVoice))) * 0.35;
  gl_FragColor = vec4(c * (1.0 + 0.2 * uBeatPop), a * tw * uOpacity);
}
`;
