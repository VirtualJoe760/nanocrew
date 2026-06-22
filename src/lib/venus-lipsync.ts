// src/lib/venus-lipsync.ts
//
// Real audio → viseme lip-sync driver for the R3F Venus avatar.
// Web-first (Web Audio API). Zero runtime deps, no `import.meta` — Metro-safe.
//
// Usage (web):
//   const driver = createVenusLipsync();
//   driver.connect(htmlAudioElement);   // src must already be set
//   // each frame:
//   const weights = driver.sample();    // { viseme_aa: 0.7, jawOpen: 0.4, ... }
//
// The driver returns *target* weights in 0..1. The caller (useFrame) is
// responsible for damping toward them — see venus-head-scene.tsx.
//
// It only ever emits jaw/mouth/viseme_* morphs. It never touches eyes,
// brows, or head — the idle/liveliness layer owns those.

import { speechFrameAt, speechActiveAt } from '@/lib/venus-speech-level';

// The 15 RPM Oculus visemes that exist on this avatar (verified from the GLB).
export const VISEME_NAMES = [
  'viseme_sil', 'viseme_PP', 'viseme_FF', 'viseme_TH', 'viseme_DD',
  'viseme_kk', 'viseme_CH', 'viseme_SS', 'viseme_nn', 'viseme_RR',
  'viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U',
] as const;

// Extra ARKit morphs we layer additively for openness (all present on the GLB).
export const MOUTH_EXTRAS = ['jawOpen', 'mouthOpen', 'mouthClose'] as const;

// Every morph this driver is allowed to write. The frame loop zeroes exactly
// this set each tick so lip-sync can never bleed into the liveliness layer.
export const LIPSYNC_MORPHS: readonly string[] = [...VISEME_NAMES, ...MOUTH_EXTRAS];

export type VisemeWeights = Record<string, number>;

export type VenusLipsync = {
  /** Connect an <audio>/<video> element whose `src` is already set. Idempotent. */
  connect(el: HTMLMediaElement): void;
  /** Live mic instead of an element. */
  connectMicrophone(): Promise<void>;
  /** Call once per frame. Returns target weights (0..1) for lip-sync morphs. */
  sample(): VisemeWeights;
  /** Resume a suspended AudioContext (call from a user gesture / play handler). */
  resume(): void;
  /** True while REAL audio is actively driving the mouth (so the scene won't run a synthetic flap
   *  over it, and keeps lip-syncing while her buffered audio finishes after the turn "completes").
   *  Optional — drivers without a real source (web AnalyserNode test path) leave it undefined. */
  speaking?(): boolean;
  /** Last debug snapshot (for the test harness HUD). */
  debug: { viseme: string; rms: number; centroid: number; hfRatio: number };
  dispose(): void;
};

// Flip to true ONLY after `npm i wawa-lipsync`. See the adapter at the bottom.
const USE_WAWA = false;

// ─── thresholds (approximate — tuned for typical speech formants; retune to
//     Venus's actual TTS voice using the test harness HUD) ────────────────────
const SILENCE_RMS = 0.012;   // below this → mouth closed (viseme_sil)
const OPEN_GAIN = 14;        // rms → openness multiplier (8..18)
const FRICATIVE_HF = 0.55;   // high-freq energy ratio above this → SS/FF/CH
// vowel split by spectral centroid (Hz). dark→rounded, bright→spread.
const C_U = 900, C_O = 1500, C_AA = 2200, C_E = 3200;

function zeroWeights(): VisemeWeights {
  const w: VisemeWeights = {};
  for (const n of LIPSYNC_MORPHS) w[n] = 0;
  return w;
}

class AnalyserDriver implements VenusLipsync {
  private ctx: AudioContext;
  private analyser: AnalyserNode;
  private freq: Uint8Array<ArrayBuffer>;
  private time: Float32Array<ArrayBuffer>;
  private binHz: number;
  private srcEl: HTMLMediaElement | null = null;
  private srcNode: MediaElementAudioSourceNode | MediaStreamAudioSourceNode | null = null;
  debug = { viseme: 'viseme_sil', rms: 0, centroid: 0, hfRatio: 0 };

  constructor(fftSize = 1024) {
    const AC: typeof AudioContext =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AC();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = fftSize;
    this.analyser.smoothingTimeConstant = 0.6;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.time = new Float32Array(this.analyser.fftSize);
    this.binHz = this.ctx.sampleRate / fftSize;
  }

  resume() {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  connect(el: HTMLMediaElement) {
    this.resume();
    if (this.srcEl === el) return;          // idempotent: one source node per element
    this.srcEl = el;
    // NOTE: createMediaElementSource may throw if the element was already
    // routed through another AudioContext — guard so a re-render can't crash.
    try {
      const node = this.ctx.createMediaElementSource(el);
      node.connect(this.analyser);
      this.analyser.connect(this.ctx.destination); // keep audio audible
      this.srcNode = node;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[venus-lipsync] connect failed (already routed?)', e);
    }
  }

  async connectMicrophone() {
    this.resume();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const node = this.ctx.createMediaStreamSource(stream);
    node.connect(this.analyser);            // do NOT connect mic to destination (feedback)
    this.srcNode = node;
  }

  sample(): VisemeWeights {
    const w = zeroWeights();
    this.analyser.getByteFrequencyData(this.freq);
    this.analyser.getFloatTimeDomainData(this.time);

    // RMS amplitude → openness
    let sumSq = 0;
    for (let i = 0; i < this.time.length; i++) sumSq += this.time[i] * this.time[i];
    const rms = Math.sqrt(sumSq / this.time.length);
    this.debug.rms = rms;

    if (rms < SILENCE_RMS) {
      w.viseme_sil = 1;
      this.debug.viseme = 'viseme_sil';
      this.debug.centroid = 0;
      this.debug.hfRatio = 0;
      return w;                              // mouth fully closed at silence
    }

    // spectral centroid (Hz) + high-frequency energy ratio (sibilance)
    let num = 0, den = 0, hi = 0;
    const hiStart = Math.floor(4000 / this.binHz); // ~4kHz+ ≈ fricatives
    for (let i = 1; i < this.freq.length; i++) {
      const a = this.freq[i] / 255;
      num += i * this.binHz * a;
      den += a;
      if (i >= hiStart) hi += a;
    }
    const centroid = den > 0 ? num / den : 0;
    const hfRatio = den > 0 ? hi / den : 0;
    this.debug.centroid = centroid;
    this.debug.hfRatio = hfRatio;

    const open = Math.min(1, rms * OPEN_GAIN);

    let viseme: string;
    if (hfRatio > FRICATIVE_HF) {
      // strong high-frequency hiss → sibilant/fricative (closed-ish, teeth showing)
      viseme = centroid > 5500 ? 'viseme_SS' : 'viseme_FF';
      // fricatives barely open the jaw
      w[viseme] = Math.min(1, 0.5 + open * 0.4);
      w.jawOpen = open * 0.3;
      w.mouthOpen = open * 0.15;
    } else {
      // voiced → pick a vowel mouth shape from the centroid
      if (centroid < C_U) viseme = 'viseme_U';
      else if (centroid < C_O) viseme = 'viseme_O';
      else if (centroid < C_AA) viseme = 'viseme_aa';
      else if (centroid < C_E) viseme = 'viseme_E';
      else viseme = 'viseme_I';
      w[viseme] = Math.min(1, 0.55 + open * 0.6);
      w.jawOpen = open * 0.9;                // amplitude → jaw is what reads as "talking"
      w.mouthOpen = open * 0.5;
    }
    this.debug.viseme = viseme;
    return w;
  }

  dispose() {
    try { this.srcNode?.disconnect(); } catch {}
    try { this.analyser.disconnect(); } catch {}
    void this.ctx.close();
  }
}

// Web Audio API present? It's web-only — React Native has no AudioContext, so the analyser driver
// (which does `new AudioContext()`) would crash with "Cannot read property 'prototype' of undefined".
function hasWebAudio(): boolean {
  return typeof window !== 'undefined' && !!((window as any).AudioContext || (window as any).webkitAudioContext);
}

// No-op driver for platforms without Web Audio (native). The avatar still renders and animates; it
// just isn't driven by real audio amplitude. A native audio-analysis path can replace this later.
class NullDriver implements VenusLipsync {
  debug = { viseme: 'viseme_sil', rms: 0, centroid: 0, hfRatio: 0 };
  connect() {}
  async connectMicrophone() {}
  sample(): VisemeWeights {
    return zeroWeights();
  }
  resume() {}
  dispose() {}
}

// ─── native driver: drives the mouth from Venus's REAL spoken audio ──────────────────────────────
// React Native has no Web Audio AnalyserNode, but the live-voice layer already decodes Gemini's PCM
// and feeds a time-synced loudness/brightness envelope into venus-speech-level.ts. This reads that
// envelope each frame: loudness → jaw openness (silent ⇒ closed), zero-crossing-rate → vowel vs.
// sibilant mouth shape. No FFT, no extra audio graph — it analyses the exact samples being played.
const NATIVE_SILENCE = 0.012; // RMS below this ⇒ mouth closed (between words / at rest)
const NATIVE_GAIN = 11; // RMS → jaw openness (normal speech RMS ~0.08–0.18 opens most of the way)
const NATIVE_JAW = 0.8; // loudness → jaw drop (lower = calmer, less gape)
const FRICATIVE_ZCR = 0.17; // zero-crossing rate above this ⇒ sibilant/fricative (teeth, near-closed)
// Within voiced speech, brightness (ZCR) tracks vowel frontness: dark/back vowels (oo, oh) have low
// ZCR, bright/front vowels (ee, eh) high. Map that range so the mouth shape follows the real sound.
const VOWEL_DARK = 0.03; // ZCR at/below ⇒ rounded back vowel (O)
const VOWEL_BRIGHT = 0.12; // ZCR at/above ⇒ spread front vowel (E)

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

class SpeechLevelDriver implements VenusLipsync {
  debug = { viseme: 'viseme_sil', rms: 0, centroid: 0, hfRatio: 0 };
  connect() {}
  async connectMicrophone() {}
  resume() {}
  dispose() {}
  speaking(): boolean {
    return speechActiveAt();
  }
  sample(): VisemeWeights {
    const w = zeroWeights();
    const { level, zcr } = speechFrameAt();
    this.debug.rms = level;
    this.debug.hfRatio = zcr;
    if (level < NATIVE_SILENCE) {
      w.viseme_sil = 1;
      this.debug.viseme = 'viseme_sil';
      return w;
    }
    const open = Math.min(1, level * NATIVE_GAIN);
    if (zcr > FRICATIVE_ZCR) {
      // sibilant/fricative — bright noise: teeth nearly together, jaw barely parts
      const v = zcr > 0.34 ? 'viseme_SS' : 'viseme_FF';
      w[v] = Math.min(1, 0.45 + open * 0.4);
      w.jawOpen = open * 0.22;
      this.debug.viseme = v;
    } else {
      // voiced — brightness (ZCR) crossfades the vowel SHAPE from the actual sound: dark → rounded
      // (O), mid → open (aa), bright → spread (E). This is what stops every syllable rounding into
      // "O": the rounded shape now only appears on genuinely dark sounds, not by default. Loudness
      // drives the jaw; NO mouthOpen (it was adding the rounded gape).
      const b = clamp01((zcr - VOWEL_DARK) / (VOWEL_BRIGHT - VOWEL_DARK)); // 0 dark .. 1 bright
      const wO = Math.max(0, 1 - b * 2); // rounded, only for clearly-dark sounds
      const wE = Math.max(0, b * 2 - 1); // spread, only for clearly-bright sounds
      const wAa = 1 - wO - wE; // open — the neutral middle
      w.jawOpen = open * NATIVE_JAW;
      w.viseme_O = open * 0.5 * wO;
      w.viseme_aa = open * 0.75 * wAa;
      w.viseme_E = open * 0.6 * wE;
      this.debug.viseme = wE >= wAa && wE >= wO ? 'viseme_E' : wO > wAa ? 'viseme_O' : 'viseme_aa';
    }
    return w;
  }
}

// ─── factory ─────────────────────────────────────────────────────────────────
export function createVenusLipsync(): VenusLipsync {
  // Native (no Web Audio): drive the mouth from the real spoken-audio envelope fed by live-voice.ts.
  if (!hasWebAudio()) return new SpeechLevelDriver();
  if (USE_WAWA) {
    try {
      // Optional path. Only reached if you set USE_WAWA = true AND installed the
      // package. require() (not import) keeps Metro from trying to resolve it at
      // bundle time when the dep is absent.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const wawa = require('wawa-lipsync');
      return new WawaDriver(wawa.Lipsync, wawa.VISEMES);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[venus-lipsync] wawa-lipsync not available, using AnalyserNode', e);
    }
  }
  return new AnalyserDriver();
}

// ─── optional wawa-lipsync adapter (inert unless USE_WAWA && installed) ───────
// wawa emits a SINGLE dominant viseme whose values ARE the RPM viseme_* names,
// so the map is the identity. It does not emit jawOpen — we still derive that
// from an internal AnalyserNode (amplitude) for natural openness.
class WawaDriver implements VenusLipsync {
  private mgr: any;
  private jaw = new AnalyserDriver(1024); // jaw openness only
  debug = { viseme: 'viseme_sil', rms: 0, centroid: 0, hfRatio: 0 };

  constructor(Lipsync: any, _VISEMES: any) {
    this.mgr = new Lipsync({ fftSize: 2048, historySize: 10 });
  }
  resume() { this.jaw.resume(); }
  connect(el: HTMLMediaElement) { this.mgr.connectAudio(el); this.jaw.connect(el); }
  async connectMicrophone() { await this.mgr.connectMicrophone(); await this.jaw.connectMicrophone(); }
  sample(): VisemeWeights {
    this.mgr.processAudio();
    const w = zeroWeights();
    const jawW = this.jaw.sample();                 // gives jawOpen/mouthOpen + rms debug
    const silent = this.mgr.state === 'silence' || (this.mgr.features?.volume ?? 0) < 0.08;
    if (silent) { w.viseme_sil = 1; this.debug.viseme = 'viseme_sil'; return w; }
    const active: string = this.mgr.viseme || 'viseme_sil';
    w[active] = 1;
    w.jawOpen = jawW.jawOpen ?? 0;
    w.mouthOpen = jawW.mouthOpen ?? 0;
    this.debug = { viseme: active, rms: jawW.rms ?? 0, centroid: 0, hfRatio: 0 };
    return w;
  }
  dispose() { this.jaw.dispose(); }
}
