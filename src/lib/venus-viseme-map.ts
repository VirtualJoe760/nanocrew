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
// mapFeaturesToWeights — pure feature → morph weights, all in [0,1].
// ─────────────────────────────────────────────────────────────────────────────

export function mapFeaturesToWeights(f: AcousticFeatures): Record<string, number> {
  const w = emptyWeights();

  // ── SILENCE ──
  if (f.rms < SILENCE_RMS) {
    w.viseme_sil = 1;
    w.mouthClose = 0.05;
    return w;
  }

  // ── SIBILANT / FRICATIVE (unvoiced, hissy high-frequency energy) ──
  if (!f.voiced && f.hf > FRICATIVE_HF) {
    // Classify by where the noise sits.
    //   bright, very-high energy (>~4.5 kHz weight) → /s, z/  → SS
    //   mid 2–4 kHz                                  → /ʃ, tʃ/ → CH
    //   flat / low-amplitude broadband               → /f, θ/  → FF/TH
    if (f.hf > 0.6 && f.bandHigh < 0.18) {
      // energy concentrated above the bandHigh window → very bright sibilant
      w.viseme_SS = clamp01(0.6 + f.hf * 0.4);
    } else if (f.bandMid + f.bandHigh > 0.3) {
      w.viseme_CH = clamp01(0.6 + f.hf * 0.3);
    } else if (f.hf > FRICATIVE_HF) {
      w.viseme_SS = clamp01(0.55 + f.hf * 0.4);
    } else {
      // flatter, low-amplitude → labiodental/dental fricative
      if (f.bandMid > f.bandHigh) w.viseme_FF = 0.6;
      else w.viseme_TH = 0.6;
    }
    // jaw barely parts; NO funnel/pucker/stretch on fricatives.
    w.jawOpen = clamp01(0.15 + f.rms * 0.6); // capped well below vowel openness
    if (w.jawOpen > 0.25) w.jawOpen = 0.25;
    return w;
  }

  // ── VOICED VOWELS — continuous ARKit axes (the core fix) ──
  // F1 (vowel height) is the PRIMARY jaw driver and is LEVEL-INDEPENDENT — open vowels open the jaw
  // regardless of how loud the recording is. Loudness only MODULATES (0.7..1.0), so a quiet voice
  // still articulates and louder speech opens a bit more. A base term keeps close vowels (ee/oo)
  // slightly parted so voiced speech never looks clenched.
  const loud = clamp01((f.rms - RMS_FLOOR) / (RMS_FULL - RMS_FLOOR));
  const openAmt = clamp01((f.f1 - F1_CLOSED) / (F1_OPEN - F1_CLOSED));
  const loudMod = JAW_LOUD_FLOOR + (1 - JAW_LOUD_FLOOR) * loud;
  w.jawOpen = clamp01(jawGain * (JAW_BASE + JAW_SPAN * openAmt) * loudMod);

  // F2 low → rounding; F2 high → spread. The mid-F2 gap leaves both at ~0
  // (neutral), which is exactly what kills the default "O".
  const round = clamp01((F2_ROUND - f.f2) / (F2_ROUND - F2_ROUND_MIN));
  const spread = clamp01((f.f2 - F2_SPREAD_LO) / (F2_SPREAD_HI - F2_SPREAD_LO));

  w.mouthFunnel = clamp01(round * FUNNEL);
  w.mouthPucker = clamp01(round * PUCKER);
  w.mouthStretchLeft = clamp01(spread * STRETCH);
  w.mouthStretchRight = clamp01(spread * STRETCH);

  // Optional SMALL viseme_aa for open vowels only (reads as a fuller open mouth).
  // Rounding NEVER comes from viseme_O — only from funnel/pucker above.
  if (openAmt > 0.5 && round < 0.2) {
    w.viseme_aa = clamp01(openAmt * SMALL_AA);
  }

  return w;
}
