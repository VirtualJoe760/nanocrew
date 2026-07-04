// ============================================================================
// venus-points.ts — UNIFIED FIELD spec assets for the Venus<->background merge.
//
// THE VISION: Venus and the app dot-field are ONE superintelligence. At pre-render
// the field IS the ambient Skia dot-field (rendered now in R3F, not Skia). On morph,
// the dots that become her PEEL UP from the field and cyclone into her face+aurora.
// The residual stays a living background pulsing toward her.
//
// This file holds the two NEW shaders (LATTICE = ambient field + peel-up face dots)
// and the JS helpers (motionEnergy pattern selection) that the build-once bake +
// useFrame in venus-head-scene.tsx import. ES2-safe GLSL only: precision mediump,
// no #version 300, no dynamic loops, no derivatives. Build-once attributes; only
// uniforms change per frame.
// ============================================================================
// ── shared Skia-look GLSL chunk (ported 1:1 from dot-field-scene.tsx SKSL) ────
// Evaluated per-DOT at its baked aCell instead of per-fragment at floor(g).
// hash21 / hsv2rgb / motionEnergy are byte-for-byte the SKSL math (float2->vec2 etc).
// Pattern SELECTION (selA/selB/fade) is hoisted to JS uniforms (see motionSelect)
// so the shader does ONE if/else ladder per selected pattern — no hashing of the
// 12s window in-shader, fewer ALU, same look.
const SKIA_CHUNK = /* glsl */ `
  float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  vec3 hsv2rgb(vec3 c){ vec3 p = abs(fract(c.xxx + vec3(1.0, 0.6666667, 0.3333333)) * 6.0 - 3.0); return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y); }
  // energy (0..1) for one motion pattern, chosen by 'sel' — identical to SKSL motionEnergy
  float motionEnergy(float sel, vec2 cell, float t){
    float e;
    if (sel < 0.2)      e = sin((cell.x + cell.y) * 0.28 - t * 1.1);
    else if (sel < 0.4) e = sin(length(cell) * 0.30 - t * 0.9);
    else if (sel < 0.6) e = sin(cell.x * 0.32 - t) * 0.6 + sin(cell.y * 0.32 - t * 0.7) * 0.6;
    else if (sel < 0.8) e = sin(atan(cell.y, cell.x) * 3.0 + length(cell) * 0.25 - t);
    else                e = sin(t * 1.3 + hash21(cell) * 6.2831);
    return 0.5 + 0.5 * e;
  }
  // full per-dot Skia color+brightness at cell (drift already folded into 'cell' by JS/vert).
  // selA/selB/fade are uniforms (the 12s crossfade window, computed in JS each frame).
  // dCenter = precomputed |aHome.xy - screenCenter| / vH  → the Skia vignette (no derivatives).
  void skiaLook(vec2 cell, float t, float selA, float selB, float fade, float dCenter,
                out vec3 oColor, out float oVal){
    float energy = mix(motionEnergy(selA, cell, t), motionEnergy(selB, cell, t), fade);
    float hue = fract(t * 0.10 + (cell.x + cell.y) * 0.02);
    float sat = 0.5 + 0.5 * sin(t * 0.20);
    float val = 0.05 + 0.95 * energy;
    val *= (1.0 - 0.30 * dCenter * dCenter);          // Skia vignette
    oColor = hsv2rgb(vec3(hue, sat, val));
    oVal = val;
  }
`;

// ── LATTICE vertex shader — ONE buffer, aIsFace branches ambient vs. peel-up ──
// AMBIENT dots (aIsFace<0.5): sit at aHome doing the Skia look + drift + inward pulse.
// FACE dots  (aIsFace>0.5): at lp=0 render the SAME Skia look at aHome (indistinguishable
//   from a neighbour), then PEEL UP — brighten, lift off aHome, run today's NODE_VERT
//   cyclone (verbatim) to aTarget, go hot-white in flight, land as aurora 'color'.
// CRITICAL: this fixes the invisibility bug. Today NODE_VERT line 117
//   `lift = smoothstep(0.0,0.22,lp)` gates vGlow to 0 at the grid (dots POP in). Here the
//   face dot STARTS at the ambient val and ADDS spark/aurora as lp rises → it peels up.
export const LATTICE_VERT = /* glsl */ `
  precision mediump float;
  ${SKIA_CHUNK}
  uniform float uTime;          // = t (st.clock.elapsedTime % 600)
  uniform float uMorph;         // = seg(0.1,0.62), the cyclone window 0..1
  uniform float uReveal;        // = raw R 0..1
  uniform float uPulse;         // residual inward-pulse strength (rises after she forms)
  uniform float uSpeak;         // jawOpen energy (twinkle/pulse boost)
  uniform float uTalk;          // 0..1 talking gate — drives the speech pulse down her face
  uniform float uBlip;          // rare holographic instability
  uniform float uLead;          // 1 = dots LEAD (orb shape-morph: membrane gone, dots draw the object). Default 0 → head scene unchanged.
  uniform float uSpinY;         // orb-only (default 0 → head scene unchanged): the orb's netGroup rotates
  uniform float uTgtScale;      // + breathes; rotate/swell the LANDING TARGETS identically so landed dots stay ON their somas. Swell is an OFFSET (0 = ×1).
  uniform float uSelA, uSelB, uFade;   // Skia 12s pattern-crossfade (JS-computed)
  uniform vec2  uDrift;         // = (t*0.010, t*0.006) — Skia parallax, uv units
  uniform float uCellScale;     // uv->cell factor = ROWS / (2.0) (see bake); for drift->cell
  uniform vec3  uCenter;        // funnel axis = faceCentroid (group-local)
  uniform float uSwirl, uUpdraft, uInfall; // cyclone (18.0 / 0.72 / 0.85)
  attribute vec2  aCell;        // integer grid coords (Skia hue/energy)
  attribute vec3  aHome;        // resting lattice position (group-local)
  attribute vec3  aTarget;      // face-vertex landing position (group-local); =aHome for ambient
  attribute float aFaceY;       // face-vertex height: 0 at the bottom (chin/neck) … 1 crown; 0 ambient
  attribute float aDelay, aRadius, aSpan, aRand, aIsFace, aDCenter;
  varying vec3  vColor;
  varying float vGlow;
  mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
  void main() {
    // drifted cell for the Skia look (parallax) — keeps the pattern scrolling like Skia.
    vec2 cell = aCell + uDrift * uCellScale;
    vec3 ambColor; float ambVal;
    skiaLook(cell, uTime, uSelA, uSelB, uFade, aDCenter, ambColor, ambVal);
    float tw = 0.9 + 0.1 * sin(uTime * 2.0 + aRand * 6.2831);

    // ---------- AMBIENT base position (fixed dots + residual inward pulse) ------
    // NOTE: the Skia parallax scrolls the *pattern* (via cell above), NOT the dot
    // positions — translating a FINITE point set by uDrift would march every dot off
    // screen. So pAmb stays at aHome; only the colour/energy field scrolls.
    vec3 pAmb = aHome;
    float pulseWave = 0.5 + 0.5 * sin(uTime * 0.6 - distance(aHome, uCenter) * 4.0);
    pAmb = mix(pAmb, mix(pAmb, uCenter, 0.10), uPulse * pulseWave); // <=10% lean toward her

    // ---------- FACE cyclone (today's NODE_VERT, anchored aHome->aTarget) ------
    // the landing target tracks the orb group's live spin + breath (no-op when uSpinY/uTgtScale=0)
    vec3 tgt = aTarget * (1.0 + uTgtScale);
    tgt.xz = rot(uSpinY) * tgt.xz;
    float lp   = clamp((uMorph - aDelay) / max(1e-3, 1.0 - aDelay), 0.0, 1.0);
    float ease = lp * lp * (3.0 - 2.0 * lp);
    float land = smoothstep(0.82, 1.0, lp);
    float fly  = sin(lp * 3.14159);
    float rNow = mix(aRadius, aRadius * (1.0 - uInfall), ease);
    vec3  pCyc = mix(aHome, tgt, ease);
    float spinFall = 1.0 / (0.35 + rNow * 2.5);
    float ang = uSwirl * fly * spinFall + uTime * (1.0 - ease) * 0.6;
    pCyc.xz = rot(ang) * (pCyc.xz - uCenter.xz) + uCenter.xz;
    vec2 rel = pCyc.xz - uCenter.xz;
    float curR = max(length(rel), 1e-4);
    vec2 dir = rel / curR;
    float pinch = mix(curR, rNow, fly * 0.9);
    pCyc.xz = uCenter.xz + dir * pinch;
    pCyc.y += fly * uUpdraft * (0.4 + 0.6 * aSpan) * (1.0 - land);

    // ---------- per-dot SELECT (no divergent if; blend ambient<->cyclone) ------
    // peel: face dots cross over the first ~18% of their progress; ambient dots stay (lp=0).
    float peel = smoothstep(0.0, 0.18, lp) * aIsFace;
    vec3 p = mix(pAmb, pCyc, peel);

    // ---------- COLOR + GLOW (start at ambient, ADD spark/aurora as it peels) --
    float matT  = smoothstep(0.55, 1.0, lp);
    float spark = 0.6 + 1.4 * fly;
    vec3  faceColor = mix(vec3(0.85, 0.95, 1.0), color, matT);     // hot-white -> aurora
    float faceGlow  = (0.5 * matT + spark * (1.0 - matT));         // bright in flight
    float landFade  = 1.0 - land * 0.85 * (1.0 - uLead);          // fade dot glow at land (handoff to the membrane) — UNLESS the dots lead
    // ambient brightness for BOTH kinds; face dots add their flight term, scaled by peel:
    vColor = mix(ambColor, faceColor, peel);
    vGlow  = (ambVal + peel * faceGlow * landFade) * tw * (1.0 + uSpeak * 0.4);

    // ---------- SPEECH WAVE — dots light up her mesh BOTTOM→TOP while talking ----------
    // A band of light sweeps UP her face (aFaceY 0 bottom → 1 top), lighting the face dots it
    // passes; jawOpen (uSpeak) punches it. Gated to her face dots (aIsFace) + talking (uTalk).
    float wave = fract(uTime * 0.5);                        // 0 (bottom) → 1 (top), repeating
    float band = exp(-(aFaceY - wave) * (aFaceY - wave) * 55.0);
    float talkPulse = band * aIsFace * uTalk * (0.7 + 1.6 * uSpeak);
    vColor = mix(vColor, vec3(0.80, 0.95, 1.0), clamp(talkPulse, 0.0, 0.7)); // lit dots read brighter
    vGlow += talkPulse;
    // dots-lead boost: landed dots hold a steady glow so the object silhouette reads on its own.
    vGlow += aIsFace * uLead * land * (0.9 + 0.4 * uTalk);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float flightSize = 1.0 + fly * 0.9 * aIsFace;
    float basePx = mix(3.4, 6.0, aIsFace);   // ambient dots small/even; face dots can flare
    gl_PointSize = clamp(basePx * (0.5 + vGlow) * flightSize * (1.0 / -mv.z), 1.5, 11.0);
    gl_Position  = projectionMatrix * mv;
  }
`;

// ── LATTICE fragment shader — soft dot + cheap inner-bloom, additive ──────────
export const LATTICE_FRAG = /* glsl */ `
  precision mediump float;
  uniform sampler2D uDot;
  uniform float uBlip;
  varying vec3  vColor;
  varying float vGlow;
  void main() {
    float a = texture2D(uDot, gl_PointCoord).a;
    a = a + 0.4 * a * a;                              // inner-bloom (replaces glowPts)
    gl_FragColor = vec4(vColor * vGlow * uBlip, a);   // additive
  }
`;

// ── motionSelect — JS port of the Skia 12s pattern crossfade window ───────────
// Computes selA/selB/fade exactly like the SKSL (PHASE=12, hash21(idx,7)). Called once
// per frame in useFrame; result fed to uSelA/uSelB/uFade so the shader stays branch-light.
function hash21(x: number, y: number): number {
  let px = (x * 123.34) % 1; let py = (y * 456.21) % 1;
  px = px - Math.floor(px); py = py - Math.floor(py);
  const d = px * (px + 45.32) + py * (py + 45.32);
  px += d; py += d;
  const r = (px % 1) * (py % 1);
  return r - Math.floor(r);
}
export function motionSelect(t: number): { selA: number; selB: number; fade: number } {
  const PHASE = 12.0;
  const seg = t / PHASE;
  const idx = Math.floor(seg);
  const frac = seg - idx;
  const f = (frac - 0.82) / (1.0 - 0.82);
  const fc = Math.min(1, Math.max(0, f));
  const fade = fc * fc * (3 - 2 * fc); // smoothstep(0.82,1.0,fract(seg))
  return { selA: hash21(idx, 7.0), selB: hash21(idx + 1.0, 7.0), fade };
}

export const _SKIA_CHUNK_FOR_REUSE = SKIA_CHUNK;
