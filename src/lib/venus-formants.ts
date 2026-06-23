// src/lib/venus-formants.ts
//
// Pure, zero-dependency acoustic feature extraction for formant-based lip-sync.
//
// Imports NOTHING from three / expo / react-native / audio libs — it runs in
// plain Node (for the test suite) and in Hermes (at runtime). Hermes-safe:
// only Float32Array / Int16Array, plain Math, no Float64Array-only APIs, no
// Node built-ins.
//
// The job: take a window of mono PCM samples (Gemini female TTS is 24000 Hz
// PCM16) and report formant-style acoustic features — F1/F2 (the vowel
// identity that the old ZCR/centroid path lacked), band energies, rms, zcr,
// and a voiced flag. The feature→morph mapping lives in venus-viseme-map.ts.

// ─────────────────────────────────────────────────────────────────────────────
// Public type
// ─────────────────────────────────────────────────────────────────────────────

export type AcousticFeatures = {
  /** RMS amplitude of the (windowed-input) frame, 0..1. */
  rms: number;
  /** Zero-crossing rate, 0..1 (fraction of sample pairs that cross zero). */
  zcr: number;
  /** First formant frequency, Hz (peak of the spectral envelope in 200–1100 Hz). */
  f1: number;
  /** Second formant frequency, Hz (peak in 800–3000 Hz, constrained > f1). */
  f2: number;
  /** Voiced (vowel-like) vs. unvoiced/silent. */
  voiced: boolean;
  /** High-frequency energy ratio (>4000 Hz / total), 0..1 — sibilance. */
  hf: number;
  /** 300–1000 Hz energy / total, 0..1. */
  bandLow: number;
  /** 1000–2500 Hz energy / total, 0..1. */
  bandMid: number;
  /** 2500–3500 Hz energy / total, 0..1. */
  bandHigh: number;
  /** F1 pick fell back to a band edge (no interior envelope max) — a degenerate/unreliable frame.
   *  Per-voice calibration (VoiceNorm) skips these so a glitch window can't skew the anchors. */
  f1Edge?: boolean;
  /** F2 pick fell back to a band edge (no interior envelope max). */
  f2Edge?: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// FFT — iterative radix-2 Cooley-Tukey, in-place, power-of-two sizes.
// re[] / im[] are mutated in place to hold the spectrum.
// ─────────────────────────────────────────────────────────────────────────────

/** In-place iterative radix-2 FFT. `re`/`im` length must be a power of two. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) {
    throw new Error('fft: length must be a power of two, got ' + n);
  }

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }

  // Danielson-Lanczos butterflies.
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (-2 * Math.PI) / len;
    const wStepR = Math.cos(ang);
    const wStepI = Math.sin(ang);
    for (let start = 0; start < n; start += len) {
      let wR = 1;
      let wI = 0;
      for (let k = 0; k < half; k++) {
        const iEven = start + k;
        const iOdd = start + k + half;
        const evenR = re[iEven];
        const evenI = im[iEven];
        const oddR = re[iOdd];
        const oddI = im[iOdd];
        // t = w * odd
        const tR = wR * oddR - wI * oddI;
        const tI = wR * oddI + wI * oddR;
        re[iEven] = evenR + tR;
        im[iEven] = evenI + tI;
        re[iOdd] = evenR - tR;
        im[iOdd] = evenI - tI;
        // advance twiddle: w *= wStep
        const nwR = wR * wStepR - wI * wStepI;
        wI = wR * wStepI + wI * wStepR;
        wR = nwR;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Window / spectrum helpers
// ─────────────────────────────────────────────────────────────────────────────

const FFT_SIZE = 1024;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Copy `samples` into a length-`FFT_SIZE` Float32Array as floats in ~[-1,1]. */
function toFloatFrame(samples: Float32Array | Int16Array): Float32Array {
  const out = new Float32Array(FFT_SIZE);
  const isInt16 = samples instanceof Int16Array;
  const n = Math.min(samples.length, FFT_SIZE);
  if (isInt16) {
    for (let i = 0; i < n; i++) out[i] = samples[i] / 32768;
  } else {
    for (let i = 0; i < n; i++) out[i] = samples[i];
  }
  return out; // tail (n..FFT_SIZE) stays zero-padded
}

/** Hann window applied in place. */
function applyHann(frame: Float32Array): void {
  const n = frame.length;
  const denom = n - 1;
  for (let i = 0; i < n; i++) {
    // 0.5 - 0.5 cos(2πi/(n-1))
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / denom);
    frame[i] *= w;
  }
}

/**
 * Parabolic peak interpolation around bin `i` given magnitude samples
 * mags[i-1], mags[i], mags[i+1]. Returns a fractional bin offset in [-0.5, 0.5].
 */
function parabolicOffset(mLeft: number, mMid: number, mRight: number): number {
  const denom = mLeft - 2 * mMid + mRight;
  if (denom === 0) return 0;
  const off = (0.5 * (mLeft - mRight)) / denom;
  if (off < -0.5) return -0.5;
  if (off > 0.5) return 0.5;
  return off;
}

// ─────────────────────────────────────────────────────────────────────────────
// analyzeWindow — the core extractor
// ─────────────────────────────────────────────────────────────────────────────

const SILENCE_FLOOR = 0.004; // below this rms → unvoiced (silence)

export function analyzeWindow(
  samples: Float32Array | Int16Array,
  sampleRate: number
): AcousticFeatures {
  // ── time-domain features computed on the RAW (un-windowed) frame ──
  const isInt16 = samples instanceof Int16Array;
  const rawLen = samples.length;
  let sumSq = 0;
  let crossings = 0;
  let prev = 0;
  for (let i = 0; i < rawLen; i++) {
    const s = isInt16 ? (samples as Int16Array)[i] / 32768 : (samples as Float32Array)[i];
    sumSq += s * s;
    if (i > 0) {
      if ((prev <= 0 && s > 0) || (prev >= 0 && s < 0)) crossings++;
    }
    prev = s;
  }
  const rms = rawLen > 0 ? Math.min(1, Math.sqrt(sumSq / rawLen)) : 0;
  const zcr = rawLen > 1 ? crossings / (rawLen - 1) : 0;

  // ── frequency-domain ──
  const frame = toFloatFrame(samples);
  applyHann(frame);
  const re = frame; // reuse: real part is the windowed signal
  const im = new Float32Array(FFT_SIZE);
  fft(re, im);

  const half = FFT_SIZE >> 1; // 512 usable bins (0..Nyquist)
  const binHz = sampleRate / FFT_SIZE; // ≈ 23.4 Hz at 24k/1024
  const mags = new Float32Array(half);
  for (let i = 0; i < half; i++) {
    mags[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  }

  // ── band energies (use raw magnitude spectrum) ──
  let eLow = 0; // 300–1000
  let eMid = 0; // 1000–2500
  let eHigh = 0; // 2500–3500
  let eHF = 0; // >4000
  let eTot = 0;
  for (let i = 1; i < half; i++) {
    const f = i * binHz;
    const m = mags[i];
    eTot += m;
    if (f >= 300 && f < 1000) eLow += m;
    if (f >= 1000 && f < 2500) eMid += m;
    if (f >= 2500 && f < 3500) eHigh += m;
    if (f > 4000) eHF += m;
  }
  const inv = eTot > 0 ? 1 / eTot : 0;
  const bandLow = eLow * inv;
  const bandMid = eMid * inv;
  const bandHigh = eHigh * inv;
  const hf = eHF * inv;

  // ── smoothed spectral envelope to suppress female-f0 harmonic peaks ──
  // f0 ≈ 180–220 Hz. Harmonic spacing in bins ≈ f0 / binHz ≈ 200/23.4 ≈ 8.5.
  // A moving average wide enough to span ~1 harmonic spacing flattens the comb
  // so the envelope peaks land on FORMANTS, not on individual harmonics.
  const envHalfWidth = 5; // window = 11 bins ≈ 1.3 × harmonic spacing
  const env = movingAverage(mags, envHalfWidth);

  // ── formant picking on the SMOOTHED envelope, snapped to the nearest raw
  //    harmonic peak ──
  // The envelope (f0-comb suppressed) locates the formant REGION; we then snap
  // to the strongest raw harmonic within ~1 harmonic spacing so the reported
  // frequency tracks the actual resonance, not the smoothing's centroid.
  const harmonicBins = Math.round(220 / binHz); // ~1 female-f0 spacing in bins
  const p1 = pickFormant(env, mags, binHz, 200, 1100, 0, harmonicBins);
  const f1 = p1.hz;
  // F2 must be higher than F1; raise the low edge to just above F1.
  const f2LoHz = Math.max(800, f1 + 150);
  const p2 = pickFormant(env, mags, binHz, f2LoHz, 3000, f1, harmonicBins);
  const f2 = p2.hz;

  // ── voiced decision ──
  // Voiced if low-frequency band carries energy, the frame isn't a sibilant
  // hiss (low zcr), and it's above the silence floor.
  const voiced = rms > SILENCE_FLOOR && zcr < 0.10 && bandLow > 0.12;

  return {
    rms,
    zcr: clamp01(zcr),
    f1,
    f2,
    voiced,
    hf: clamp01(hf),
    bandLow: clamp01(bandLow),
    bandMid: clamp01(bandMid),
    bandHigh: clamp01(bandHigh),
    f1Edge: p1.edge,
    f2Edge: p2.edge,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// internals
// ─────────────────────────────────────────────────────────────────────────────

/** Symmetric moving average over a magnitude array, half-window `h` (window 2h+1). */
function movingAverage(mags: Float32Array, h: number): Float32Array {
  const n = mags.length;
  const out = new Float32Array(n);
  // Prefix sums for O(n).
  const prefix = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + mags[i];
  for (let i = 0; i < n; i++) {
    const lo = i - h < 0 ? 0 : i - h;
    const hi = i + h >= n ? n - 1 : i + h;
    const count = hi - lo + 1;
    out[i] = (prefix[hi + 1] - prefix[lo]) / count;
  }
  return out;
}

/**
 * Find the strongest envelope peak whose frequency is within [loHz, hiHz] and
 * strictly above `minHz`. Uses parabolic sub-bin interpolation. Returns the
 * center of the search band if no internal local-max is found (degenerate).
 */
function pickFormant(
  env: Float32Array,
  mags: Float32Array,
  binHz: number,
  loHz: number,
  hiHz: number,
  minHz: number,
  snapRadius: number
): { hz: number; edge: boolean } {
  const n = env.length;
  const effLo = Math.max(loHz, minHz);
  let loBin = Math.floor(effLo / binHz);
  let hiBin = Math.ceil(hiHz / binHz);
  if (loBin < 1) loBin = 1;
  if (hiBin > n - 2) hiBin = n - 2;
  if (hiBin <= loBin) return { hz: effLo, edge: true };

  // Strongest envelope bin in band first (robust fallback if no strict local max).
  let bestBin = loBin;
  let bestMag = -1;
  for (let i = loBin; i <= hiBin; i++) {
    if (env[i] > bestMag) {
      bestMag = env[i];
      bestBin = i;
    }
  }

  // Prefer a true interior local maximum of the ENVELOPE (the formant region,
  // with the f0 comb already suppressed by smoothing).
  let regionBin = bestBin;
  let regionMag = -1;
  for (let i = loBin; i <= hiBin; i++) {
    if (env[i] >= env[i - 1] && env[i] >= env[i + 1] && env[i] > regionMag) {
      regionMag = env[i];
      regionBin = i;
    }
  }
  // No interior local maximum of the envelope was found → the pick is just the band's strongest bin
  // (often a band edge), an unreliable/degenerate frame. Flag it so calibration can skip it.
  const edge = regionMag < 0;
  if (edge) regionBin = bestBin;

  // Snap to the strongest RAW harmonic peak within ±snapRadius bins of the
  // envelope region peak (clamped to the search band). The envelope tells us
  // WHICH resonance; the raw spectrum tells us its exact harmonic frequency —
  // this resolves the smoothing's centroid bias without re-admitting the comb.
  let sLo = regionBin - snapRadius;
  let sHi = regionBin + snapRadius;
  if (sLo < loBin) sLo = loBin;
  if (sHi > hiBin) sHi = hiBin;
  let peakBin = regionBin;
  let peakRaw = -1;
  for (let i = sLo; i <= sHi; i++) {
    if (mags[i] > peakRaw) {
      peakRaw = mags[i];
      peakBin = i;
    }
  }
  if (peakBin < 1) peakBin = 1;
  if (peakBin > n - 2) peakBin = n - 2;

  const off = parabolicOffset(mags[peakBin - 1], mags[peakBin], mags[peakBin + 1]);
  return { hz: (peakBin + off) * binHz, edge };
}
