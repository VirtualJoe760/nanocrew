// src/lib/venus-viseme-map.ts
//
// Pure, zero-dependency feature → morph-weight mapping for formant lip-sync.
// This is the actual "fix": instead of rounding every syllable into "O" by
// picking vowels from spectral brightness (ZCR/centroid), we drive CONTINUOUS
// ARKit mouth shapes from F1/F2 formants (a JALI-style jaw-vs-lip split):
//
//   • F1 (vowel height)  → jawOpen      (open vowels drop the jaw)
//   • F2 (vowel backness) → mouthFunnel/mouthPucker (rounding, back vowels)
//                          OR mouthStretchL/R (spread, front vowels)
//
// Rounding and spread are mutually exclusive by the mid-F2 gap, so the mouth
// only rounds on genuinely back/round vowels — never by default.
//
// Imports NOTHING. Hermes-safe. PURE + deterministic: no time/hysteresis
// state — temporal smoothing is the render layer's job (done separately by the
// integrator in venus-head-scene.tsx).

import type { AcousticFeatures } from '@/lib/venus-formants';

// ─────────────────────────────────────────────────────────────────────────────
// The morphs this mapper may output. The driver widens its owned-morph set from
// this list so lip-sync never bleeds into the liveliness layer.
// ─────────────────────────────────────────────────────────────────────────────

export const MOUTH_MORPHS: readonly string[] = [
  // continuous ARKit axes (the core)
  'jawOpen',
  'mouthFunnel',
  'mouthPucker',
  'mouthStretchLeft',
  'mouthStretchRight',
  'mouthClose',
  'mouthOpen',
  // consonant / silence visemes
  'viseme_sil',
  'viseme_SS',
  'viseme_FF',
  'viseme_CH',
  'viseme_TH',
  'viseme_PP',
  'viseme_nn',
  'viseme_RR',
  'viseme_DD',
  'viseme_kk',
  // a small optional open-vowel viseme (rounding NEVER comes from viseme_O)
  'viseme_aa',
];

// ─────────────────────────────────────────────────────────────────────────────
// Tuning knobs (exposed for the integrator's HUD).
// ─────────────────────────────────────────────────────────────────────────────

export const SILENCE_RMS = 0.012; // below → mouth closed (viseme_sil)
export const FRICATIVE_HF = 0.45; // hf above this (and unvoiced) → sibilant/fricative

export const jawGain = 0.6; // overall jaw magnitude scale (raise for more articulation / more gape)
export const JAW_BASE = 0.12; // jaw opening on ANY voiced frame (close vowels still part the lips)
export const JAW_SPAN = 0.62; // extra jaw from vowel openness (F1). BASE+SPAN = max jaw on an open vowel
export const JAW_LOUD_FLOOR = 0.6; // jaw retained when quiet-but-voiced (loudness modulates 0.6..1.0)
export const FUNNEL = 0.85; // round → mouthFunnel
export const PUCKER = 0.7; // round → mouthPucker
export const STRETCH = 0.9; // spread → mouthStretchL/R

// vowel-axis anchors (Hz) — calibrated to an adult FEMALE voice (Venus's TTS), whose vowel F1 runs
// ~430 (close: ee/oo) to ~940 (open: aa). A male voice sits lower; if you swap voices, re-anchor.
export const F1_CLOSED = 350; // F1 at/below → jaw shut
export const F1_OPEN = 900; // F1 at/above → jaw fully open (female open-vowel F1 ≈ 936)
export const F2_ROUND = 1500; // F2 at/below → fully rounded
export const F2_ROUND_MIN = 950; // floor of the rounding ramp
export const F2_SPREAD_LO = 1900; // F2 above this → spread begins
export const F2_SPREAD_HI = 2761; // F2 at/above → fully spread (female /iy/)

// rms → loudness gate for the voiced jaw drop
const RMS_FLOOR = 0.012; // rms at/below → no drive
const RMS_FULL = 0.1; // rms at/above → full drive (normal TTS speech ~0.05–0.15)
const SMALL_AA = 0.2; // optional viseme_aa cap for open vowels

// ─────────────────────────────────────────────────────────────────────────────
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function emptyWeights(): Record<string, number> {
  const w: Record<string, number> = {};
  for (const m of MOUTH_MORPHS) w[m] = 0;
  return w;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-voice calibration (VoiceCal) + the rich mapping context.
//
// The vowel-axis anchors above are pinned to ONE female TTS voice. VoiceCal lets a driver pass
// self-calibrated anchors (running F1/F2/rms/hf stats) so the same mapper fits any voice. SEED_CAL
// reproduces today's hardcoded anchors EXACTLY — it's the warmup target and the test baseline.
// ─────────────────────────────────────────────────────────────────────────────

export type VoiceCal = {
  F1_CLOSED: number; // F1 at/below → jaw shut
  F1_OPEN: number; // F1 at/above → jaw fully open
  F2_ROUND_MIN: number; // floor of the rounding ramp
  F2_SPREAD_HI: number; // F2 at/above → fully spread
  F2_ROUND: number; // F2 at/below → fully rounded
  F2_SPREAD_LO: number; // F2 above this → spread begins (the neutral gap is [F2_ROUND..F2_SPREAD_LO])
  rmsRef: number; // the voice's "normal speech" loudness (≈ today's RMS_FULL)
  hfRef: number; // the voice's resting high-frequency ratio (fricatives sit above hfRef + 0.20)
};

export const SEED_CAL: VoiceCal = {
  F1_CLOSED, F1_OPEN, F2_ROUND_MIN, F2_SPREAD_HI, F2_ROUND, F2_SPREAD_LO,
  rmsRef: RMS_FULL, hfRef: 0.1,
};

const SEED_F1_MED = 600;
const SEED_F2_MED = 1700;

function clampRange(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

// ─────────────────────────────────────────────────────────────────────────────
// VoiceNorm — self-calibrating per-voice anchors. A driver feeds it the RAW per-window features; it
// tracks leaky F1/F2 min/max + medians and produces a VoiceCal so the mapper isn't pinned to one TTS
// voice. Stateful, but kept OUT of the pure mapper (the driver owns one and reads cal() as a snapshot).
// Warms up FROM the seed anchors (first ~1.6s == today's behaviour) then slides to the live voice.
// Bounded everywhere (voiced-gate, edge-frame reject, median deadband, hard clamps, >=600Hz gap floor)
// so a glitch window can't skew it and the neutral gap (the O-fix) can never collapse.
// ─────────────────────────────────────────────────────────────────────────────

const VN_EMA_N = 48;
const VN_EMA_A = 1 - Math.exp(-1 / VN_EMA_N);
const VN_WARMUP = 40; // voiced frames to fully trust the learned anchors

export class VoiceNorm {
  private f1Lo = SEED_CAL.F1_CLOSED;
  private f1Hi = SEED_CAL.F1_OPEN;
  private f2Lo = SEED_CAL.F2_ROUND_MIN;
  private f2Hi = SEED_CAL.F2_SPREAD_HI;
  private f1Med = SEED_F1_MED;
  private f2Med = SEED_F2_MED;
  private rmsMed = SEED_CAL.rmsRef;
  private hfMed = SEED_CAL.hfRef;
  private voicedSeen = 0;

  /** Feed one RAW analyzed window. No-op on unvoiced frames (formants are meaningless there). */
  update(f: AcousticFeatures): void {
    if (!f.voiced) return;
    this.voicedSeen++;
    this.rmsMed += (f.rms - this.rmsMed) * VN_EMA_A;
    this.hfMed += (f.hf - this.hfMed) * VN_EMA_A;
    if (f.rms < 0.3 * this.rmsMed) return; // too quiet → unreliable formants
    // F1: skip degenerate (edge) picks and single-window glitches (>40% off the running median).
    if (!f.f1Edge && Math.abs(f.f1 - this.f1Med) < 0.4 * this.f1Med) {
      this.f1Med += (f.f1 - this.f1Med) * VN_EMA_A;
      this.f1Lo += (f.f1 - this.f1Lo) * (f.f1 < this.f1Lo ? 0.25 : 0.005);
      this.f1Hi += (f.f1 - this.f1Hi) * (f.f1 > this.f1Hi ? 0.25 : 0.005);
    }
    if (!f.f2Edge && Math.abs(f.f2 - this.f2Med) < 0.4 * this.f2Med) {
      this.f2Med += (f.f2 - this.f2Med) * VN_EMA_A;
      this.f2Lo += (f.f2 - this.f2Lo) * (f.f2 < this.f2Lo ? 0.25 : 0.005);
      this.f2Hi += (f.f2 - this.f2Hi) * (f.f2 > this.f2Hi ? 0.25 : 0.005);
    }
    this.f1Lo = clampRange(this.f1Lo, 250, 1000);
    this.f1Hi = clampRange(this.f1Hi, 250, 1000);
    this.f2Lo = clampRange(this.f2Lo, 800, 3200);
    this.f2Hi = clampRange(this.f2Hi, 800, 3200);
    if (this.f1Hi - this.f1Lo < 200) this.f1Hi = this.f1Lo + 200;
    if (this.f2Hi - this.f2Lo < 600) this.f2Hi = this.f2Lo + 600;
  }

  /** A frozen VoiceCal: learned anchors blended up from the seed over the warmup. */
  cal(): VoiceCal {
    const blend = this.voicedSeen >= VN_WARMUP ? 1 : this.voicedSeen / VN_WARMUP;
    const lerp = (seed: number, learned: number) => seed + (learned - seed) * blend;
    const span = this.f2Hi - this.f2Lo;
    const mid = (this.f2Lo + this.f2Hi) / 2;
    const halfGap = Math.max(150, 0.16 * span); // guarantees a >=300Hz neutral gap for any voice
    return {
      F1_CLOSED: lerp(SEED_CAL.F1_CLOSED, this.f1Lo),
      F1_OPEN: lerp(SEED_CAL.F1_OPEN, this.f1Hi),
      F2_ROUND_MIN: lerp(SEED_CAL.F2_ROUND_MIN, this.f2Lo),
      F2_SPREAD_HI: lerp(SEED_CAL.F2_SPREAD_HI, this.f2Hi),
      F2_ROUND: lerp(SEED_CAL.F2_ROUND, mid - halfGap),
      F2_SPREAD_LO: lerp(SEED_CAL.F2_SPREAD_LO, mid + halfGap),
      rmsRef: lerp(SEED_CAL.rmsRef, this.rmsMed),
      hfRef: lerp(SEED_CAL.hfRef, this.hfMed),
    };
  }

  /** Re-seed (e.g. an explicit voice change). Barge-in within a session should NOT call this. */
  reset(): void {
    this.f1Lo = SEED_CAL.F1_CLOSED; this.f1Hi = SEED_CAL.F1_OPEN;
    this.f2Lo = SEED_CAL.F2_ROUND_MIN; this.f2Hi = SEED_CAL.F2_SPREAD_HI;
    this.f1Med = SEED_F1_MED; this.f2Med = SEED_F2_MED;
    this.rmsMed = SEED_CAL.rmsRef; this.hfMed = SEED_CAL.hfRef;
    this.voicedSeen = 0;
  }
}

/** Optional rich context. When omitted, the mapper is BYTE-IDENTICAL to the original (the regression
 *  floor). When present, it unlocks calibration, consonant articulation, vowel identity, and look-ahead
 *  coarticulation. `raw` is the UN-SMOOTHED current frame (closures vanish under the feature EMA, so
 *  transients must be read raw). `aheadFar`/`aheadNear` are real BUFFERED future frames — `undefined`
 *  means "not buffered / unknown", which the mapper treats as "no look-ahead" (NOT as silence). */
export type MapContext = {
  cal?: VoiceCal;
  raw?: AcousticFeatures;
  aheadFar?: AcousticFeatures; // ~120ms ahead
  aheadNear?: AcousticFeatures; // ~55ms ahead
  prevVoiced?: boolean;
  prevVowel?: string; // last frame's winning vowel viseme (identity hysteresis)
};

// rich-path tuning
const VOWEL_ID_GAIN = 0.5; // the vowel-identity coat is additive flavour, not a replacement
const ID_DEADZONE = 0.25; // below this max score → neutral schwa, no identity (protects the O-fix gap)
const ID_GATE = 0.55; // winner must beat this share of the max before any identity weight is emitted
const HYST_MARGIN = 0.15; // a challenger must beat the held winner by this to switch (anti-pop)
const COARTIC = 0.3; // anticipatory rounding lead strength
const GLIDE = 0.25; // continuous-axis easing toward the look-ahead frame
const VOWEL_ID_KEYS = ['viseme_O', 'viseme_U', 'viseme_E', 'viseme_I', 'viseme_aa'] as const;

function richEmpty(): Record<string, number> {
  const w = emptyWeights();
  w.viseme_O = 0; w.viseme_U = 0; w.viseme_E = 0; w.viseme_I = 0; // the 4 cardinal vowel visemes
  return w;
}

function isClosureShape(g: AcousticFeatures, rmsRef: number, hfRef: number): boolean {
  // A bilabial seal = a near-silent, low-zcr, low-hf RAW dip.
  return g.rms < 0.45 * rmsRef && g.zcr < 0.12 && g.hf - hfRef < 0.05;
}

// ─────────────────────────────────────────────────────────────────────────────
// mapFeaturesToWeights — pure feature → morph weights, all in [0,1].
// Single-arg (no ctx) → the original mapper, untouched. With ctx → the ultra-realistic path.
// ─────────────────────────────────────────────────────────────────────────────

export function mapFeaturesToWeights(
  f: AcousticFeatures,
  ctx?: MapContext,
): Record<string, number> {
  return ctx ? mapRich(f, ctx) : mapBasic(f);
}

// The ORIGINAL mapper — kept verbatim as the regression floor (single-arg path is byte-identical).
function mapBasic(f: AcousticFeatures): Record<string, number> {
  const w = emptyWeights();

  // ── SILENCE ──
  if (f.rms < SILENCE_RMS) {
    w.viseme_sil = 1;
    w.mouthClose = 0.05;
    return w;
  }

  // ── SIBILANT / FRICATIVE (unvoiced, hissy high-frequency energy) ──
  if (!f.voiced && f.hf > FRICATIVE_HF) {
    if (f.hf > 0.6 && f.bandHigh < 0.18) {
      w.viseme_SS = clamp01(0.6 + f.hf * 0.4);
    } else if (f.bandMid + f.bandHigh > 0.3) {
      w.viseme_CH = clamp01(0.6 + f.hf * 0.3);
    } else if (f.hf > FRICATIVE_HF) {
      w.viseme_SS = clamp01(0.55 + f.hf * 0.4);
    } else {
      if (f.bandMid > f.bandHigh) w.viseme_FF = 0.6;
      else w.viseme_TH = 0.6;
    }
    w.jawOpen = clamp01(0.15 + f.rms * 0.6);
    if (w.jawOpen > 0.25) w.jawOpen = 0.25;
    return w;
  }

  // ── VOICED VOWELS — continuous ARKit axes (the core fix) ──
  const loud = clamp01((f.rms - RMS_FLOOR) / (RMS_FULL - RMS_FLOOR));
  const openAmt = clamp01((f.f1 - F1_CLOSED) / (F1_OPEN - F1_CLOSED));
  const loudMod = JAW_LOUD_FLOOR + (1 - JAW_LOUD_FLOOR) * loud;
  w.jawOpen = clamp01(jawGain * (JAW_BASE + JAW_SPAN * openAmt) * loudMod);

  const round = clamp01((F2_ROUND - f.f2) / (F2_ROUND - F2_ROUND_MIN));
  const spread = clamp01((f.f2 - F2_SPREAD_LO) / (F2_SPREAD_HI - F2_SPREAD_LO));

  w.mouthFunnel = clamp01(round * FUNNEL);
  w.mouthPucker = clamp01(round * PUCKER);
  w.mouthStretchLeft = clamp01(spread * STRETCH);
  w.mouthStretchRight = clamp01(spread * STRETCH);

  if (openAmt > 0.5 && round < 0.2) {
    w.viseme_aa = clamp01(openAmt * SMALL_AA);
  }

  return w;
}

// The ultra-realistic path. Adds: voice-relative thresholds, bilabial closure (lips MEET on /p,b,m/),
// per-vowel identity (gated so it can't reintroduce the O-bug), and look-ahead coarticulation.
function mapRich(f: AcousticFeatures, ctx: MapContext): Record<string, number> {
  const cal = ctx.cal ?? SEED_CAL;
  const raw = ctx.raw ?? f; // closures are read on the un-smoothed frame
  const w = richEmpty();

  const rmsRef = cal.rmsRef;
  const denom = Math.max(rmsRef - RMS_FLOOR, 0.01);
  const loud = clamp01((f.rms - RMS_FLOOR) / denom);
  const hfRel = raw.hf - cal.hfRef;
  const silFloor = Math.max(SILENCE_RMS, 0.18 * rmsRef);

  // ── SILENCE / PAUSE (voice-relative) ──
  if (f.rms < silFloor) {
    w.viseme_sil = 1;
    w.mouthClose = 0.05;
    return w;
  }

  // ── BILABIAL CLOSURE /p,b,m/ — the headline. A near-silent low-hf RAW dip that re-voices (look-ahead)
  //    or follows voicing (fallback) → the lips MEET. Detected on RAW (the EMA would erase the dip). ──
  const ahead = ctx.aheadFar;
  const aheadKnown = ahead !== undefined;
  const dipDepth = clamp01((0.45 * rmsRef - raw.rms) / (0.45 * rmsRef));
  if (isClosureShape(raw, rmsRef, cal.hfRef)) {
    const reopens = aheadKnown && ahead!.voiced && ahead!.rms > 0.5 * rmsRef;
    const finalPause = aheadKnown && !ahead!.voiced && ahead!.rms < silFloor;
    if (reopens || (!aheadKnown && ctx.prevVoiced)) {
      const closeAmt = clamp01(0.55 + dipDepth * 0.45);
      w.viseme_PP = clamp01(0.65 + closeAmt * 0.35);
      w.mouthClose = clamp01(0.55 + closeAmt * 0.45); // the visible lip seal
      w.jawOpen = clamp01(0.05 + 0.1 * loud);
      return w; // antagonist: no funnel/stretch/vowel on a closure
    }
    if (finalPause) {
      w.viseme_sil = clamp01(0.5 + (1 - loud) * 0.5);
      w.mouthClose = 0.2;
      w.jawOpen = clamp01(0.05 * loud);
      return w;
    }
  }

  // ── FRICATIVE / SIBILANT (voice-relative hf) — same SS/CH/FF/TH split as the basic path ──
  if (!f.voiced && hfRel > 0.2) {
    if (raw.hf > 0.6 && f.bandHigh < 0.18) {
      w.viseme_SS = clamp01(0.6 + raw.hf * 0.4);
    } else if (f.bandMid + f.bandHigh > 0.3) {
      w.viseme_CH = clamp01(0.6 + raw.hf * 0.3);
    } else if (hfRel > 0.2) {
      w.viseme_SS = clamp01(0.55 + raw.hf * 0.4);
    } else {
      if (f.bandMid > f.bandHigh) w.viseme_FF = 0.6;
      else w.viseme_TH = 0.6;
    }
    w.jawOpen = clamp01(0.15 + loud * 0.1);
    if (w.jawOpen > 0.25) w.jawOpen = 0.25;
    return w;
  }

  // ── VOICED VOWEL — continuous core (the O-fix), calibrated anchors ──
  const openAmt = clamp01((f.f1 - cal.F1_CLOSED) / (cal.F1_OPEN - cal.F1_CLOSED));
  const loudMod = JAW_LOUD_FLOOR + (1 - JAW_LOUD_FLOOR) * loud;
  w.jawOpen = clamp01(jawGain * (JAW_BASE + JAW_SPAN * openAmt) * loudMod);

  let round = clamp01((cal.F2_ROUND - f.f2) / (cal.F2_ROUND - cal.F2_ROUND_MIN));
  let spread = clamp01((f.f2 - cal.F2_SPREAD_LO) / (cal.F2_SPREAD_HI - cal.F2_SPREAD_LO));

  // ── COARTICULATION — anticipate the next buffered frame (native look-ahead only) ──
  if (ctx.aheadFar && ctx.aheadFar.voiced) {
    const af = ctx.aheadFar;
    const aOpen = clamp01((af.f1 - cal.F1_CLOSED) / (cal.F1_OPEN - cal.F1_CLOSED));
    const aRound = clamp01((cal.F2_ROUND - af.f2) / (cal.F2_ROUND - cal.F2_ROUND_MIN));
    const aSpread = clamp01((af.f2 - cal.F2_SPREAD_LO) / (cal.F2_SPREAD_HI - cal.F2_SPREAD_LO));
    // anticipatory rounding (lead only into round vowels; never pre-spread)
    let lead = Math.max(0, aRound - round) * COARTIC;
    if (spread > 0 || aSpread > 0) lead = 0; // reversal guard
    round = Math.max(round, round + lead);
    // glide easing of the continuous axes toward the next frame
    const easedShape = (JAW_BASE + JAW_SPAN * openAmt) + ((JAW_BASE + JAW_SPAN * aOpen) - (JAW_BASE + JAW_SPAN * openAmt)) * GLIDE;
    w.jawOpen = clamp01(jawGain * easedShape * loudMod);
    round = clamp01(round + (aRound - round) * GLIDE);
    spread = clamp01(spread + (aSpread - spread) * GLIDE);
  }

  w.mouthFunnel = clamp01(round * FUNNEL);
  w.mouthPucker = clamp01(round * PUCKER);
  w.mouthStretchLeft = clamp01(spread * STRETCH);
  w.mouthStretchRight = clamp01(spread * STRETCH);

  // anticipatory bilabial closure: if a closure is coming up, start sealing now (scaled by proximity)
  let antiClose = 0;
  if (ctx.aheadNear && isClosureShape(ctx.aheadNear, rmsRef, cal.hfRef)) antiClose = 0.5;
  else if (ctx.aheadFar && isClosureShape(ctx.aheadFar, rmsRef, cal.hfRef)) antiClose = 0.25;
  if (antiClose > 0) {
    w.mouthClose = Math.max(w.mouthClose, antiClose);
    w.viseme_PP = Math.max(w.viseme_PP, 0.3 * antiClose);
    w.jawOpen *= 0.6;
  }

  // ── VOWEL IDENTITY COAT — soft-argmax over O/U/E/I/aa, gated so it inherits the neutral-gap O-fix ──
  // "Height" for vowel identity needs a LOWER midpoint than the jaw's openAmt: close vowels (/i,u/,
  // F1≈300-420) vs mid (/e,o/, F1≈500-560) split around F1 ≈ 40% of the open range, so /o/≠/u/ and
  // /e/≠/i/. (openAmt — midpoint ~625Hz — would lump mid vowels in with close ones.)
  const f1Mid = cal.F1_CLOSED + 0.4 * (cal.F1_OPEN - cal.F1_CLOSED);
  const hi = clamp01((f1Mid - f.f1) / (f1Mid - cal.F1_CLOSED)); // 1 = close (I/U), 0 = mid/open (E/O)
  // Identity front/back is measured from the NEUTRAL-GAP CENTRE (not the conservative round/spread
  // ramps), so a mid vowel like /e/ still reads as front. The mouth SHAPE keeps using round/spread,
  // so the O-fix gap is untouched; only the (gated, dead-zoned) identity label is more sensitive.
  const idCenter = (cal.F2_ROUND + cal.F2_SPREAD_LO) / 2;
  const idBack = clamp01((idCenter - f.f2) / (idCenter - cal.F2_ROUND_MIN));
  const idFront = clamp01((f.f2 - idCenter) / (cal.F2_SPREAD_HI - idCenter));
  const scores: Record<string, number> = {
    viseme_U: hi * idBack,
    viseme_O: (1 - hi) * idBack,
    viseme_I: hi * idFront,
    viseme_E: (1 - hi) * idFront,
    viseme_aa: openAmt * clamp01(1 - idBack - idFront),
  };
  let argmax = '';
  let vmax = 0;
  for (const k of VOWEL_ID_KEYS) {
    if (scores[k] > vmax) { vmax = scores[k]; argmax = k; }
  }
  if (vmax >= ID_DEADZONE && argmax) {
    // hysteresis: hold the previous winner unless the challenger beats it by HYST_MARGIN
    let winner = argmax;
    const prev = ctx.prevVowel;
    if (prev && prev in scores && prev !== argmax && scores[argmax] <= scores[prev] + HYST_MARGIN) {
      winner = prev;
    }
    const vw = scores[winner] / vmax;
    if (vw > ID_GATE) {
      w[winner] = clamp01((vw - ID_GATE) / (1 - ID_GATE)) * VOWEL_ID_GAIN;
      // consistency clamp: a rounded vowel can't also spread, and vice-versa
      if ((winner === 'viseme_O' || winner === 'viseme_U') && w[winner] > 0) {
        w.mouthStretchLeft *= 1 - w[winner];
        w.mouthStretchRight *= 1 - w[winner];
      } else if ((winner === 'viseme_E' || winner === 'viseme_I') && w[winner] > 0) {
        w.mouthFunnel *= 1 - w[winner];
        w.mouthPucker *= 1 - w[winner];
      }
    }
  }

  // ── OUTPUT NORMALIZATION ──
  // closure dominance: lips win over the jaw
  const closeTot = Math.max(w.mouthClose, w.viseme_PP);
  w.jawOpen *= 1 - 0.8 * closeTot;
  // lip-area budget: round and spread can't both occupy the mouth — keep the larger group
  const roundGroup = w.mouthFunnel + w.mouthPucker;
  const spreadGroup = w.mouthStretchLeft + w.mouthStretchRight;
  if (roundGroup > 0.05 && spreadGroup > 0.05) {
    if (roundGroup >= spreadGroup) { w.mouthStretchLeft = 0; w.mouthStretchRight = 0; }
    else { w.mouthFunnel = 0; w.mouthPucker = 0; }
  }
  // consonant→vowel crossfade: an active (anticipatory) consonant suppresses the vowel identity
  const consTot = Math.max(w.viseme_PP, w.viseme_FF, w.viseme_TH, w.viseme_SS, w.viseme_CH);
  for (const vk of VOWEL_ID_KEYS) {
    if (w[vk]) w[vk] *= 1 - 0.6 * consTot;
  }
  for (const k in w) w[k] = clamp01(w[k]);
  return w;
}
