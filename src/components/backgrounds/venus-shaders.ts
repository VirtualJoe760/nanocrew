// Venus GLSL shader sources — ES2/expo-gl-safe (precision mediump/highp, no #version 300,
// no dynamic loops/dFdx). Extracted from venus-head-scene.tsx. The unified-lattice shaders
// live in venus-points.ts; these are the stream / core-glow / hair / strand programs.
// ─── shaders (ES2-safe: precision mediump, no #version 300, no dynamic loops) ──
// NOTE: the face-node cyclone shader now lives in venus-points.ts as part of LATTICE_VERT
// (her dots are tagged cells of the unified background lattice, not a separate grid).

// ── the persistent dot-field that PULSES TOWARD her: a hollow shell of dots that loops
//    outer→inner (streaming into her surface) — the cyclone source during the morph, a
//    quiet inward pulse once formed. uFlow = stream strength, uIntake = swirl/pull-in. ──
export const STREAM_VERT = /* glsl */ `
  precision mediump float;
  uniform float uTime, uReveal, uFlow, uIntake, uSpeak;
  uniform vec3  uCenter;
  attribute vec3  aInner;
  attribute float aPhase;
  attribute float aRand;
  attribute float aY;
  varying vec3  vColor;
  varying float vGlow;
  mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
  void main() {
    vec3 outer = position;
    float speed = mix(0.06, 0.34, uFlow) + uSpeak * 0.12;
    float j = fract(aPhase + uTime * speed);
    float ji = j * j * (1.6 - 0.6 * j);
    vec3 p = mix(outer, aInner, ji * uFlow);
    float swirl = (0.6 + 3.0 * (1.0 - j)) * (0.3 + uIntake * 1.6);
    float dirS  = aRand < 0.5 ? -1.0 : 1.0;
    p.xz = rot(uTime * swirl * dirS) * (p.xz - uCenter.xz) + uCenter.xz;
    p = mix(p, uCenter, uIntake * 0.35 * (1.0 - ji));
    float wavePhase = fract(uTime * 0.5 - aPhase);
    float wave = exp(-(j - wavePhase) * (j - wavePhase) * 30.0);
    float arrive = smoothstep(0.55, 1.0, ji);
    float spawn  = smoothstep(0.0, 0.12, j);
    float die    = 1.0 - smoothstep(0.92, 1.0, j);
    float tw = 0.85 + 0.15 * sin(uTime * 2.0 + aRand * 6.2831);
    vGlow = (0.35 + 0.9 * wave + 1.1 * arrive * uFlow) * spawn * die * tw;
    vGlow *= (0.5 + 0.9 * uReveal);
    vGlow *= (1.0 + uSpeak * 0.8);
    vColor = mix(color, vec3(0.85, 0.95, 1.0), arrive * uFlow * 0.6);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = clamp(3.0 * vGlow * (1.0 + arrive) * (1.0 / -mv.z), 1.5, 9.0);
    gl_Position  = projectionMatrix * mv;
  }
`;
export const STREAM_FRAG = /* glsl */ `
  precision mediump float;
  uniform sampler2D uDot;
  varying vec3  vColor;
  varying float vGlow;
  void main() {
    float a = texture2D(uDot, gl_PointCoord).a;
    gl_FragColor = vec4(vColor * vGlow, a);
  }
`;
export const CORE_VERT = /* glsl */ `
  precision mediump float;
  varying vec3 vN, vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
export const CORE_FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vN, vV;
  void main() {
    float f = pow(max(dot(vV, vN), 0.0), 2.0);       // bright center, soft edge
    gl_FragColor = vec4(uColor * f, f * uOpacity);
  }
`;
// Realistic stylized HAIR shader (Kajiya-Kay / Scheuermann dual anisotropic sheen +
// strand striations + root→tip gradient + soft tapered hem + blunt-fringe edge). The
// view-space hair TANGENT is derived from a baked object-space flow dir so the crown
// sheen band slides naturally as the head sways. ES2-safe (mediump, no loops/dFdx).
export const HAIR_VERT = /* glsl */ `
  precision highp float;
  attribute float aRoot;    // 0 crown → 1 tip
  attribute float aAround;  // 0..1 azimuth (strand index around the head)
  attribute float aEdge;    // metres above this vert's A-line cut (soft taper)
  attribute float aFringe;  // 1.0 = front blunt-fringe vert
  attribute float aEdgeF;   // metres above browY (fringe verts)
  attribute vec3  aFlow;    // OBJECT-space hair flow (≈ down-strand)
  uniform mat3 uViewRot;    // object→view rotation (per-frame)
  uniform float uTime, uWaveAmp, uWaveSpeed;
  varying vec3  vN, vV, vT;
  varying float vRoot, vAround, vEdge, vFringe, vEdgeF;
  void main() {
    // gentle wave — body tips sway (aRoot² anchors roots); the FRINGE flutters at its
    // bang-tips (anchored at the scalp, swaying where aEdgeF≈0 just above the eyes).
    float bodyAmt = aRoot * aRoot * uWaveAmp;
    float fringeAmt = uWaveAmp * 0.28 * smoothstep(0.08, 0.0, aEdgeF); // bangs barely flutter (stay on the forehead)
    float amt = mix(bodyAmt, fringeAmt, aFringe);
    vec3 wpos = position;
    // multi-frequency, per-strand sway so locks drift INDEPENDENTLY — free-flowing, not a rigid helmet
    float ph = aRoot * 7.0 + aAround * 11.0;
    wpos.x += (sin(uTime * uWaveSpeed + ph) + 0.5 * sin(uTime * uWaveSpeed * 1.9 + ph * 2.1 + aAround * 5.0)) * amt;
    wpos.z += (cos(uTime * uWaveSpeed * 0.85 + aRoot * 6.0 + aAround * 9.0) + 0.45 * sin(uTime * uWaveSpeed * 1.4 + aAround * 17.0)) * amt * 0.8;
    wpos.y += sin(uTime * uWaveSpeed * 0.55 + aAround * 13.0) * amt * 0.4; // gentle lift/fall of the locks
    vec4 mv = modelViewMatrix * vec4(wpos, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    vec3 flowVS = normalize(uViewRot * aFlow);
    vec3 T = flowVS - vN * dot(flowVS, vN);
    if (dot(T, T) < 1e-4) T = cross(vN, vec3(1.0, 0.0, 0.0)); // crown-pole guard
    vT = normalize(T);
    vRoot = aRoot; vAround = aAround; vEdge = aEdge; vFringe = aFringe; vEdgeF = aEdgeF;
    gl_Position = projectionMatrix * mv;
  }
`;
export const HAIR_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3  uRoot, uTip, uRim, uSpec1, uSpec2, uLightVS;
  uniform float uExp1, uExp2, uShift1, uShift2, uSpec1Str, uSpec2Str;
  uniform float uStrandCount, uStrandWander, uTipFade, uBaseAlpha, uTime, uFade;
  varying vec3  vN, vV, vT;
  varying float vRoot, vAround, vEdge, vFringe, vEdgeF;
  float hash21(vec2 p){ p=fract(p*vec2(123.34,345.45)); p+=dot(p,p+34.345); return fract(p.x*p.y); }
  float vnoise(vec2 p){
    vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    float a=hash21(i), b=hash21(i+vec2(1.,0.)), c=hash21(i+vec2(0.,1.)), d=hash21(i+vec2(1.,1.));
    return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
  }
  vec3 shiftTangent(vec3 T, vec3 N, float s){ return normalize(T + s * N); }
  float strandSpec(vec3 T, vec3 V, vec3 L, float e){
    vec3 H = normalize(L + V); float th = dot(T, H);
    float s = sqrt(max(1.0 - th*th, 0.0));
    return smoothstep(-1.0, 0.0, th) * pow(s, e);
  }
  void main() {
    vec3 N = normalize(vN), V = normalize(vV), T = normalize(vT), L = normalize(uLightVS);
    float facing = gl_FrontFacing ? 1.0 : 0.0;
    if (facing < 0.5) N = -N; // backface = the INSIDE of the hair: flip so shading is sane
    // root→tip color + brightness
    float g = smoothstep(0.05, 1.0, vRoot);
    vec3 col = mix(uRoot, uTip, g);
    col += uTip * 0.22 * smoothstep(0.72, 1.0, vRoot);
    // DENSITY: keep most of the mass dark (deep plum), letting pink read only as highlights/sheen —
    // a dark dense volume with light catching the strands looks thick; a uniform pink film looks thin.
    col *= mix(0.32, 1.0, smoothstep(0.0, 0.22, vRoot));
    // strand striations (emerge toward the tips, calmed at the silhouette)
    float wander = (vnoise(vec2(vAround*18.0, vRoot*2.0)) - 0.5) * uStrandWander;
    // sharper per-strand bands — the dark gaps BETWEEN strands are what break the "solid block" look
    float bnd = pow(0.5 + 0.5*cos((vAround*uStrandCount + wander)*6.2831853), 2.6);
    // two clump scales (broad locks + fine flyaways) so it reads as grouped strands, not a sheet
    float clump = vnoise(vec2(vAround*26.0, vRoot*3.0))*0.55 + vnoise(vec2(vAround*60.0, vRoot*8.0))*0.45;
    float strand = mix(0.32, 1.3, mix(bnd, clump, 0.5)); // deeper dark gaps between locks → denser
    float nv = max(dot(N, V), 0.0);
    strand = mix(1.0, strand, smoothstep(0.0, 0.4, nv));
    // apply the striation EVERYWHERE (incl. crown/roots), strongest toward the tips — before, the
    // roots got *1.0 so the whole top read as one flat pink dome.
    col *= mix(mix(1.0, strand, 0.55), strand, g);
    // dual anisotropic Kajiya-Kay sheen
    float jit = (vnoise(vec2(vAround*uStrandCount, vRoot*4.0)) - 0.5) * 0.05;
    float s1 = strandSpec(shiftTangent(T, N, uShift1 + jit), V, L, uExp1) * uSpec1Str;
    float s2 = strandSpec(shiftTangent(T, N, uShift2 + jit), V, L, uExp2) * uSpec2Str;
    s2 *= mix(0.6, 1.4, hash21(floor(vec2(vAround*uStrandCount, vRoot*30.0)) + floor(uTime*6.0)));
    vec3 spec = uSpec1 * s1 + uSpec2 * s2;
    // fresnel rim (smoothed normals → clean falloff that hides facets) — softened so it reads as a
    // sheen, not a neon outline
    float f = pow(1.0 - nv, 2.6);
    col += spec + uRim * f * 0.3;
    // soft tapered A-line hem (feathered), but NOT on the blunt fringe
    float wisp = vnoise(vec2(vAround*uStrandCount*0.5, 7.0)) * uTipFade * 0.9;
    float taper = smoothstep(0.0, uTipFade, vEdge - wisp);
    float tipStrands = mix(1.0, smoothstep(0.35, 0.75, strand), 1.0 - taper);
    float fade = mix(taper, 1.0, vFringe);
    // crisp blunt-fringe cut line
    col += uTip * (1.0 - smoothstep(0.0, 0.012, vEdgeF)) * vFringe * 0.8;
    col *= mix(0.5, 1.0, facing); // the inside of the hair reads darker (but stays visible)
    float specLum = dot(spec, vec3(0.299, 0.587, 0.114));
    // wispy silhouette: at grazing angles (the hair's outline) break it into individual strands with
    // gaps instead of a solid neon edge. The interior (low fresnel) stays fully opaque.
    float edgeStrand = smoothstep(0.3, 0.86, vnoise(vec2(vAround * uStrandCount * 0.85, vRoot * 6.0)));
    float edgeWisp = mix(1.0, edgeStrand, smoothstep(0.28, 0.9, f)); // more of the outline feathers to strands
    float alpha = (uBaseAlpha + specLum * 0.7) * fade * tipStrands * uFade * edgeWisp;
    if (alpha < 0.12) discard;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

// ─── FLOWING STRAND BRISTLES ─────────────────────────────────────────────────
// A layer of ~1100 individual strand-lines over the dense shell so the hair reads as separate
// bristles that flow INDEPENDENTLY (the shell alone looks like "one piece"). Additive glow; each
// strand has its own sway phase. ES2-safe (highp, no loops/derivatives).
export const STRAND_VERT = /* glsl */ `
  precision highp float;
  attribute float aRoot;    // 0 root → 1 tip
  attribute float aPhase;   // per-strand random sway phase
  uniform float uTime, uWaveAmp, uWaveSpeed;
  varying float vRoot;
  void main() {
    vec3 p = position;
    float amt = aRoot * aRoot * uWaveAmp;            // tips sway, roots anchored
    p.x += sin(uTime * uWaveSpeed + aPhase + aRoot * 4.0) * amt;
    p.z += cos(uTime * uWaveSpeed * 0.9 + aPhase * 1.3 + aRoot * 3.0) * amt * 0.7;
    p.y += sin(uTime * uWaveSpeed * 0.6 + aPhase) * amt * 0.25;
    vRoot = aRoot;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
export const STRAND_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uRoot, uTip;
  uniform float uFade;
  varying float vRoot;
  void main() {
    vec3 col = mix(uRoot, uTip, smoothstep(0.0, 1.0, vRoot));
    col += uTip * 0.6 * smoothstep(0.55, 1.0, vRoot);      // bright bristle tips
    float a = (0.32 + 0.42 * smoothstep(0.0, 0.25, vRoot)) // fade in off the root
            * (1.0 - 0.72 * smoothstep(0.8, 1.0, vRoot))   // wispy fade at the very tip
            * uFade;
    gl_FragColor = vec4(col, a);
  }
`;
