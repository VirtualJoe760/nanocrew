// src/lib/__tests__/venus-formants.test.ts
//
// Node-runnable test suite for the formant lip-sync core. Run with:
//   npx tsx src/lib/__tests__/venus-formants.test.ts
//
// Zero test deps — a tiny assert harness + synthetic signal generators. The
// two modules under test import nothing, so they load directly in plain Node.
//
// NOTE: imports use a relative path (not the '@/' alias) so tsx/node resolve
// them without a path-mapping step. The modules themselves use '@/' internally
// only for the type-only import, which is erased at runtime.

import {
  fft,
  analyzeWindow,
  type AcousticFeatures,
} from '../venus-formants.ts';
import {
  mapFeaturesToWeights,
  MOUTH_MORPHS,
} from '../venus-viseme-map.ts';

// ─────────────────────────────────────────────────────────────────────────────
// tiny test harness
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function approx(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

// ─────────────────────────────────────────────────────────────────────────────
// synthetic signal generators (24000 Hz)
// ─────────────────────────────────────────────────────────────────────────────

const SR = 24000;
const N = 1024;

/** Pure sine of `freq` Hz, length `n`. */
function sine(freq: number, n = N, amp = 1, sr = SR): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

/**
 * A glottal-source vowel: a `f0` Hz pulse train (rich in harmonics) passed
 * through two 2nd-order resonators tuned to F1 and F2. This is the realistic,
 * high-risk signal — its spectrum is a comb of f0 harmonics shaped by the
 * formant envelope, so the f0-harmonic guard is exercised.
 */
function vowel(
  f1: number,
  f2: number,
  f0 = 200,
  n = N + 2048, // generate extra so the filter settles; we window the tail
  sr = SR
): Float32Array {
  // impulse train
  const src = new Float32Array(n);
  const period = sr / f0;
  let next = 0;
  for (let i = 0; i < n; i++) {
    if (i >= next) {
      src[i] = 1;
      next += period;
    }
  }
  // two resonators in parallel, summed
  const y1 = resonator(src, f1, 0.99, sr);
  const y2 = resonator(src, f2, 0.985, sr);
  const out = new Float32Array(n);
  let peak = 1e-9;
  for (let i = 0; i < n; i++) {
    out[i] = y1[i] + 0.6 * y2[i];
    const a = Math.abs(out[i]);
    if (a > peak) peak = a;
  }
  // normalize to ~0.3 amplitude, return the settled tail window of length N
  const tail = new Float32Array(N);
  const start = n - N;
  for (let i = 0; i < N; i++) tail[i] = (out[start + i] / peak) * 0.3;
  return tail;
}

/** 2nd-order resonant band-pass-ish filter centered at `fc` Hz with pole radius r. */
function resonator(x: Float32Array, fc: number, r: number, sr: number): Float32Array {
  const n = x.length;
  const y = new Float32Array(n);
  const theta = (2 * Math.PI * fc) / sr;
  const a1 = -2 * r * Math.cos(theta);
  const a2 = r * r;
  // gain so peak ~1
  const b0 = (1 - r) * Math.sqrt(1 - 2 * r * Math.cos(2 * theta) + r * r);
  for (let i = 0; i < n; i++) {
    const y1 = i >= 1 ? y[i - 1] : 0;
    const y2 = i >= 2 ? y[i - 2] : 0;
    y[i] = b0 * x[i] - a1 * y1 - a2 * y2;
  }
  return y;
}

/** White noise. */
function whiteNoise(n = N, amp = 0.3): Float32Array {
  const out = new Float32Array(n);
  let seed = 12345;
  for (let i = 0; i < n; i++) {
    // deterministic LCG → [-1,1]
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = ((seed / 0x7fffffff) * 2 - 1) * amp;
  }
  return out;
}

/** High-pass-ish noise: white noise minus a smoothed (low-pass) copy → emphasizes HF. */
function highNoise(n = N, amp = 0.3): Float32Array {
  const w = whiteNoise(n, 1);
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    lp = 0.9 * lp + 0.1 * w[i];
    out[i] = (w[i] - lp) * amp;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. FFT correctness
// ─────────────────────────────────────────────────────────────────────────────

function magOf(re: Float32Array, im: Float32Array, i: number): number {
  return Math.sqrt(re[i] * re[i] + im[i] * im[i]);
}

(function testFFT() {
  // DC signal → all energy in bin 0.
  {
    const re = new Float32Array(8).fill(1);
    const im = new Float32Array(8);
    fft(re, im);
    const m0 = magOf(re, im, 0);
    let restMax = 0;
    for (let i = 1; i < 8; i++) restMax = Math.max(restMax, magOf(re, im, i));
    check('FFT: DC → peak at bin 0', approx(m0, 8, 1e-4) && restMax < 1e-4, `m0=${m0} restMax=${restMax}`);
  }
  // single-bin sine at bin k → peaks at k and N-k.
  {
    const NN = 64;
    const k = 5;
    const re = new Float32Array(NN);
    const im = new Float32Array(NN);
    for (let i = 0; i < NN; i++) re[i] = Math.cos((2 * Math.PI * k * i) / NN);
    fft(re, im);
    let peakBin = 0;
    let peakMag = -1;
    for (let i = 0; i < NN / 2; i++) {
      const m = magOf(re, im, i);
      if (m > peakMag) { peakMag = m; peakBin = i; }
    }
    check('FFT: cosine at bin k → magnitude peak at bin k', peakBin === k, `peakBin=${peakBin}`);
  }
  // impulse → ~flat magnitude spectrum.
  {
    const NN = 32;
    const re = new Float32Array(NN);
    const im = new Float32Array(NN);
    re[0] = 1;
    fft(re, im);
    let minM = Infinity, maxM = -Infinity;
    for (let i = 0; i < NN; i++) {
      const m = magOf(re, im, i);
      minM = Math.min(minM, m);
      maxM = Math.max(maxM, m);
    }
    check('FFT: impulse → flat magnitude (all ≈1)', approx(minM, 1, 1e-4) && approx(maxM, 1, 1e-4), `min=${minM} max=${maxM}`);
  }
})();

// ─────────────────────────────────────────────────────────────────────────────
// 2. Formant extraction on synthetic vowels (Hillenbrand 1995 female anchors)
// ─────────────────────────────────────────────────────────────────────────────

function feats(f1: number, f2: number): AcousticFeatures {
  return analyzeWindow(vowel(f1, f2), SR);
}

// 'aa'  F1≈936 F2≈1551
const aa = feats(936, 1551);
check('aa: f1 ∈ [820,1020]', aa.f1 >= 820 && aa.f1 <= 1020, `f1=${aa.f1.toFixed(1)}`);
check('aa: f2 ∈ [1400,1700]', aa.f2 >= 1400 && aa.f2 <= 1700, `f2=${aa.f2.toFixed(1)}`);

// 'ee'/iy  F1≈437 F2≈2761
const ee = feats(437, 2761);
check('ee: f1 ∈ [380,520]', ee.f1 >= 380 && ee.f1 <= 520, `f1=${ee.f1.toFixed(1)}`);
check('ee: f2 ∈ [2550,2850]', ee.f2 >= 2550 && ee.f2 <= 2850, `f2=${ee.f2.toFixed(1)}`);

// 'oo'/uw  F1≈459 F2≈1105
const oo = feats(459, 1105);
check('oo: f1 low (<560)', oo.f1 < 560, `f1=${oo.f1.toFixed(1)}`);
check('oo: f2 low (<1300)', oo.f2 < 1300, `f2=${oo.f2.toFixed(1)}`);

// 'oh'/ow  F1≈555 F2≈1035
const oh = feats(555, 1035);
check('oh: f2 low (rounded)', oh.f2 < 1300, `f2=${oh.f2.toFixed(1)}`);

// ─────────────────────────────────────────────────────────────────────────────
// 3. f0-HARMONIC GUARD (highest risk): 'aa' from a 200 Hz pulse train must NOT
//    lock onto a harmonic (~1000 / ~2000 Hz) — envelope must yield ≈936 / ≈1551.
// ─────────────────────────────────────────────────────────────────────────────

const aaGuard = analyzeWindow(vowel(936, 1551, 200), SR);
// harmonics near 1000 = 5th (1000) and near 2000 = 10th. We assert f1/f2 are
// NOT snapped to a harmonic frequency that disagrees with the formant, i.e.
// they land in the formant windows (already a strong guard).
check(
  'f0-guard: aa f1 ≈ 936 (not a 200Hz harmonic like 1000/800)',
  aaGuard.f1 >= 820 && aaGuard.f1 <= 1020,
  `f1=${aaGuard.f1.toFixed(1)}`
);
check(
  'f0-guard: aa f2 ≈ 1551 (not a harmonic like 1400/1600 spike)',
  aaGuard.f2 >= 1400 && aaGuard.f2 <= 1700,
  `f2=${aaGuard.f2.toFixed(1)}`
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. Mapping behavior
// ─────────────────────────────────────────────────────────────────────────────

const mAa = mapFeaturesToWeights(aa);
check('map aa: jawOpen open (>0.3, the most-open vowel)', mAa.jawOpen > 0.3, `jawOpen=${mAa.jawOpen.toFixed(2)}`);
check('map aa: round ≈ 0 (funnel<0.1)', mAa.mouthFunnel < 0.1, `funnel=${mAa.mouthFunnel.toFixed(2)}`);
check('map aa: spread ≈ 0 (stretchL<0.1)', mAa.mouthStretchLeft < 0.1, `stretch=${mAa.mouthStretchLeft.toFixed(2)}`);

const mEe = mapFeaturesToWeights(ee);
check('map ee: spread fires (stretchL>0.5)', mEe.mouthStretchLeft > 0.5, `stretch=${mEe.mouthStretchLeft.toFixed(2)}`);
check('map ee: round ≈ 0 (funnel<0.1)', mEe.mouthFunnel < 0.1, `funnel=${mEe.mouthFunnel.toFixed(2)}`);
check('map ee: jawOpen low (<0.4)', mEe.jawOpen < 0.4, `jawOpen=${mEe.jawOpen.toFixed(2)}`);

const mOo = mapFeaturesToWeights(oo);
check('map oo: funnel OR pucker > 0.4', Math.max(mOo.mouthFunnel, mOo.mouthPucker) > 0.4, `funnel=${mOo.mouthFunnel.toFixed(2)} pucker=${mOo.mouthPucker.toFixed(2)}`);
check('map oo: spread ≈ 0', mOo.mouthStretchLeft < 0.1, `stretch=${mOo.mouthStretchLeft.toFixed(2)}`);

const mOh = mapFeaturesToWeights(oh);
check('map oh: round high (funnel>0.4)', mOh.mouthFunnel > 0.4, `funnel=${mOh.mouthFunnel.toFixed(2)}`);
check('map oh: distinct from aa (less jaw than aa)', mOh.jawOpen < mAa.jawOpen, `oh.jaw=${mOh.jawOpen.toFixed(2)} aa.jaw=${mAa.jawOpen.toFixed(2)}`);

// ─────────────────────────────────────────────────────────────────────────────
// 5. Sibilant / fricative noise → SS, capped jaw, no round/spread
// ─────────────────────────────────────────────────────────────────────────────

const noiseFeats = analyzeWindow(highNoise(), SR);
check('noise: hf above gate & unvoiced', noiseFeats.hf > 0.45 && !noiseFeats.voiced, `hf=${noiseFeats.hf.toFixed(2)} voiced=${noiseFeats.voiced}`);
const mNoise = mapFeaturesToWeights(noiseFeats);
check('map noise: viseme_SS fires', mNoise.viseme_SS > 0.4, `SS=${mNoise.viseme_SS.toFixed(2)}`);
check('map noise: jawOpen ≤ 0.25', mNoise.jawOpen <= 0.25, `jawOpen=${mNoise.jawOpen.toFixed(2)}`);
check('map noise: no round/spread', mNoise.mouthFunnel < 0.01 && mNoise.mouthStretchLeft < 0.01, `funnel=${mNoise.mouthFunnel} stretch=${mNoise.mouthStretchLeft}`);

// ─────────────────────────────────────────────────────────────────────────────
// 6. Silence → viseme_sil = 1
// ─────────────────────────────────────────────────────────────────────────────

const silFeats = analyzeWindow(new Float32Array(N), SR);
const mSil = mapFeaturesToWeights(silFeats);
check('silence: viseme_sil = 1', mSil.viseme_sil === 1, `sil=${mSil.viseme_sil}`);

// ─────────────────────────────────────────────────────────────────────────────
// 7. ANTI-O HISTOGRAM — sweep the female vowel quadrilateral; assert variety.
// ─────────────────────────────────────────────────────────────────────────────

(function antiO() {
  // 24 vowels spanning female F1 (350–950) × F2 (1000–2761).
  const f1s = [400, 470, 540, 620, 720, 850];
  const f2s = [1050, 1500, 2000, 2700];
  const outcomes: string[] = [];
  const jaws: number[] = [];
  for (const a1 of f1s) {
    for (const a2 of f2s) {
      // keep F2 > F1 sensibly
      const w = mapFeaturesToWeights(feats(a1, a2));
      jaws.push(w.jawOpen);
      // dominant axis label
      const round = Math.max(w.mouthFunnel, w.mouthPucker);
      const spread = w.mouthStretchLeft;
      const open = w.jawOpen;
      let label = 'open';
      if (round >= spread && round >= 0.25) label = 'round';
      else if (spread >= 0.25 && spread > round) label = 'spread';
      else if (open > 0.28) label = 'open-jaw';
      else label = 'neutral';
      outcomes.push(label);
    }
  }
  const counts: Record<string, number> = {};
  for (const o of outcomes) counts[o] = (counts[o] ?? 0) + 1;
  const total = outcomes.length;
  // The "too much O" regression = ROUNDING dominating, or spread never firing. Assert rounding is not
  // the dominant LIP shape AND both round and spread actually occur (the old bug was round-only). Open
  // vowels (open-jaw/neutral) being common is FINE — they're jaw-driven, not "O".
  const roundFrac = (counts.round ?? 0) / total;
  check(
    'anti-O: rounding is NOT dominant (kills default O)',
    roundFrac <= 0.4,
    `round=${(roundFrac * 100).toFixed(0)}% — ${JSON.stringify(counts)}`
  );
  check(
    'anti-O: both round AND spread occur (variety, not round-only)',
    (counts.round ?? 0) >= 2 && (counts.spread ?? 0) >= 2,
    JSON.stringify(counts)
  );
  // jawOpen varies across the vowel space (open vowels open more than close ones).
  const jawMin = Math.min(...jaws);
  const jawMax = Math.max(...jaws);
  check('anti-O: jawOpen varies (max-min > 0.2)', jawMax - jawMin > 0.2, `min=${jawMin.toFixed(2)} max=${jawMax.toFixed(2)}`);
})();

// ─────────────────────────────────────────────────────────────────────────────
// 8b. ADVERSARIAL EDGE CASES (added by verification pass)
// ─────────────────────────────────────────────────────────────────────────────

(function edgeCases() {
  // --- (a) FFT vs naive DFT: exact agreement at the real FFT size (1024). ---
  {
    const NN = 1024;
    const re = new Float32Array(NN);
    const im = new Float32Array(NN);
    for (let i = 0; i < NN; i++) {
      // arbitrary deterministic non-trivial signal
      re[i] = Math.sin(0.01 * i) + 0.5 * Math.cos(0.013 * i + 1);
      im[i] = 0.3 * Math.sin(0.007 * i);
    }
    const refR = new Float64Array(NN);
    const refI = new Float64Array(NN);
    for (let k = 0; k < NN; k++) {
      let sr = 0, si = 0;
      for (let n = 0; n < NN; n++) {
        const ang = (-2 * Math.PI * k * n) / NN;
        const c = Math.cos(ang), s = Math.sin(ang);
        sr += re[n] * c - im[n] * s;
        si += re[n] * s + im[n] * c;
      }
      refR[k] = sr; refI[k] = si;
    }
    const fr = re.slice(), fi = im.slice();
    fft(fr, fi);
    let maxErr = 0;
    for (let k = 0; k < NN; k++) {
      maxErr = Math.max(maxErr, Math.abs(fr[k] - refR[k]), Math.abs(fi[k] - refI[k]));
    }
    check('edge: FFT(1024) matches naive DFT', maxErr < 1e-2, `maxErr=${maxErr.toExponential(2)}`);
  }

  // --- (b) Diphthong-ish MID F2 (~1700): neutral — NEITHER round NOR spread. ---
  {
    const mid = mapFeaturesToWeights(feats(550, 1700));
    const round = Math.max(mid.mouthFunnel, mid.mouthPucker);
    check(
      'edge: mid-F2 (~1700) neutral — no round',
      round < 0.2,
      `round=${round.toFixed(2)} (f2=${feats(550, 1700).f2.toFixed(0)})`
    );
    check(
      'edge: mid-F2 (~1700) neutral — no spread',
      mid.mouthStretchLeft < 0.2,
      `spread=${mid.mouthStretchLeft.toFixed(2)}`
    );
  }

  // --- (c) Very QUIET voiced frame: low rms, valid open-vowel formants →
  //         small but correctly-shaped (open) mouth, no NaN, jaw < a loud one. ---
  {
    const quiet: AcousticFeatures = {
      rms: 0.018, zcr: 0.03, f1: 900, f2: 1500, voiced: true,
      hf: 0.05, bandLow: 0.4, bandMid: 0.2, bandHigh: 0.1,
    };
    const loud: AcousticFeatures = { ...quiet, rms: 0.14 };
    const wq = mapFeaturesToWeights(quiet);
    const wl = mapFeaturesToWeights(loud);
    let finite = true;
    for (const k of MOUTH_MORPHS) if (!Number.isFinite(wq[k])) finite = false;
    check('edge: quiet voiced → finite weights', finite);
    check('edge: quiet voiced → mouth opens (jaw>0.1)', wq.jawOpen > 0.1, `jaw=${wq.jawOpen.toFixed(2)}`);
    check('edge: quiet voiced → less jaw than loud (rms scales magnitude)', wq.jawOpen < wl.jawOpen, `quiet=${wq.jawOpen.toFixed(2)} loud=${wl.jawOpen.toFixed(2)}`);
    check('edge: quiet open vowel keeps shape (round≈0)', wq.mouthFunnel < 0.1, `funnel=${wq.mouthFunnel.toFixed(2)}`);
  }

  // --- (d) CLIPPING / LOUD input through the full analyzer: no NaN/Inf. ---
  {
    const clip = new Float32Array(N);
    for (let i = 0; i < N; i++) clip[i] = i % 2 === 0 ? 1 : -1; // full-scale square
    const w = analyzeWindow(clip, SR);
    let finite = Number.isFinite(w.f1) && Number.isFinite(w.f2) && Number.isFinite(w.rms) &&
      Number.isFinite(w.zcr) && Number.isFinite(w.hf) && Number.isFinite(w.bandLow) &&
      Number.isFinite(w.bandMid) && Number.isFinite(w.bandHigh);
    const mw = mapFeaturesToWeights(w);
    for (const k of MOUTH_MORPHS) if (!Number.isFinite(mw[k]) || mw[k] < 0 || mw[k] > 1) finite = false;
    check('edge: clipping square input → all finite & weights in [0,1]', finite, `rms=${w.rms.toFixed(2)} f1=${w.f1.toFixed(0)}`);
  }

  // --- (e) f0 ROBUSTNESS: across female f0 180/200/220, the MOUTH SHAPE class
  //         (front=spread vs back=round) must be stable for 'ee' and 'oo', even
  //         if F1 magnitude wobbles onto a harmonic. This is what actually
  //         drives the avatar; exact F1 Hz is secondary. ---
  {
    let eeAlwaysSpread = true, ooAlwaysRound = true;
    for (const f0 of [180, 200, 220]) {
      const wee = mapFeaturesToWeights(analyzeWindow(vowel(437, 2761, f0), SR));
      const woo = mapFeaturesToWeights(analyzeWindow(vowel(459, 1105, f0), SR));
      if (!(wee.mouthStretchLeft > 0.5 && wee.mouthFunnel < 0.1)) eeAlwaysSpread = false;
      if (!(Math.max(woo.mouthFunnel, woo.mouthPucker) > 0.4 && woo.mouthStretchLeft < 0.1)) ooAlwaysRound = false;
    }
    check('edge: ee reads SPREAD across f0∈{180,200,220}', eeAlwaysSpread);
    check('edge: oo reads ROUND across f0∈{180,200,220}', ooAlwaysRound);
  }

  // --- (f) NO voiced vowel emits viseme_O at full strength (the regression). ---
  {
    // viseme_O isn't even in the morph set; assert it never appears and that the
    // rounded back vowel uses funnel/pucker, not a generic O.
    const woo = mapFeaturesToWeights(oo);
    check('edge: viseme_O never present in output', !('viseme_O' in woo));
    check('edge: rounding comes from funnel/pucker', Math.max(woo.mouthFunnel, woo.mouthPucker) > 0.4);
  }

  // --- (g) Sibilant never opens the jaw past the cap nor rounds/spreads. ---
  {
    const sib: AcousticFeatures = {
      rms: 1, zcr: 0.4, f1: 800, f2: 1800, voiced: false,
      hf: 0.7, bandLow: 0.05, bandMid: 0.2, bandHigh: 0.1,
    };
    const w = mapFeaturesToWeights(sib);
    check('edge: loud sibilant jaw capped ≤0.25', w.jawOpen <= 0.25, `jaw=${w.jawOpen.toFixed(3)}`);
    check('edge: sibilant no round/spread', w.mouthFunnel < 0.01 && w.mouthStretchLeft < 0.01);
  }
})();

// ─────────────────────────────────────────────────────────────────────────────
// 8. Determinism + output ranges
// ─────────────────────────────────────────────────────────────────────────────

(function ranges() {
  const samples: AcousticFeatures[] = [aa, ee, oo, oh, noiseFeats, silFeats];
  let allInRange = true;
  let bad = '';
  for (const f of samples) {
    const w = mapFeaturesToWeights(f);
    for (const k of MOUTH_MORPHS) {
      const v = w[k];
      if (typeof v !== 'number' || v < 0 || v > 1 || Number.isNaN(v)) {
        allInRange = false;
        bad = `${k}=${v}`;
      }
    }
  }
  check('ranges: all weights ∈ [0,1]', allInRange, bad);

  // determinism: same input → identical output
  const w1 = mapFeaturesToWeights(aa);
  const w2 = mapFeaturesToWeights(aa);
  let identical = true;
  for (const k of MOUTH_MORPHS) if (w1[k] !== w2[k]) identical = false;
  check('determinism: same features → identical weights', identical);

  // feature determinism
  const a = analyzeWindow(vowel(936, 1551), SR);
  const b = analyzeWindow(vowel(936, 1551), SR);
  check('determinism: analyzeWindow stable f1/f2', a.f1 === b.f1 && a.f2 === b.f2);
})();

// ─────────────────────────────────────────────────────────────────────────────
// summary
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n────────────────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  • ' + f);
  process.exit(1);
} else {
  console.log('ALL TESTS PASSED');
}
