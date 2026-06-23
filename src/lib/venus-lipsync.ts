// src/lib/venus-lipsync.ts
//
// Real audio → viseme lip-sync driver for the R3F Venus avatar.
//
// Both platforms now share ONE acoustic model: a small FFT → F1/F2 formant estimate
// (src/lib/venus-formants.ts) → a JALI-style jaw-vs-lip morph mapping
// (src/lib/venus-viseme-map.ts). F1 drives jaw openness, F2 drives rounding (mouthFunnel/Pucker)
// vs. spreading (mouthStretch). This is what fixes the old "every syllable rounds into O" — vowel
// identity comes from formants, not from a brightness proxy.
//
//   • NATIVE  (SpeechLevelDriver): live-voice.ts feeds the exact 24 kHz PCM into
//     venus-speech-level.ts, which runs the FFT/formant extractor at push time and time-syncs the
//     features to playback. The driver reads `speechFrameAt()` each frame and maps it.
//   • WEB     (AnalyserDriver): a Web-Audio AnalyserNode gives the time-domain waveform each frame;
//     we run the SAME extractor + mapper on it, so the web Lab is a faithful preview of native.
//
// The driver returns *target* weights in 0..1. The caller (useFrame in venus-head-scene.tsx) damps
// toward them (asymmetric attack/decay). It only ever emits jaw/mouth/viseme morphs — never eyes,
// brows, or head; the idle/liveliness layer owns those.

import { speechFrameAt, speechActiveAt } from '@/lib/venus-speech-level';
import { analyzeWindow, type AcousticFeatures } from '@/lib/venus-formants';
import { mapFeaturesToWeights, MOUTH_MORPHS } from '@/lib/venus-viseme-map';

// The 15 RPM Oculus visemes that exist on this avatar (verified from the GLB).
export const VISEME_NAMES = [
  'viseme_sil', 'viseme_PP', 'viseme_FF', 'viseme_TH', 'viseme_DD',
  'viseme_kk', 'viseme_CH', 'viseme_SS', 'viseme_nn', 'viseme_RR',
  'viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U',
] as const;

// Extra ARKit jaw/mouth morphs (all present on the GLB).
export const MOUTH_EXTRAS = ['jawOpen', 'mouthOpen', 'mouthClose'] as const;

// Every morph any driver is allowed to write — the UNION of the visemes, the jaw extras, and the
// continuous ARKit shapes the formant mapper drives (mouthFunnel/Pucker/StretchL/R). The frame loop
// zeroes exactly this set each tick so lip-sync can never bleed into the liveliness layer.
export const LIPSYNC_MORPHS: readonly string[] = Array.from(
  new Set([...VISEME_NAMES, ...MOUTH_EXTRAS, ...MOUTH_MORPHS]),
);

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
  /** Last debug snapshot (for the test harness HUD): dominant viseme + the live formants. */
  debug: { viseme: string; rms: number; centroid: number; hfRatio: number; f1?: number; f2?: number };
  dispose(): void;
};

// Flip to true ONLY after `npm i wawa-lipsync`. See the adapter at the bottom.
const USE_WAWA = false;

// The dominant (highest-weight) mouth SHAPE for the debug HUD — ignore jawOpen so the label reflects
// the lip shape, not the jaw.
function dominantMorph(w: VisemeWeights): string {
  let best = 'viseme_sil';
  let bv = 0;
  for (const k in w) {
    if (k === 'jawOpen') continue;
    if (w[k] > bv) {
      bv = w[k];
      best = k;
    }
  }
  return bv > 0 ? best : 'viseme_sil';
}

// Shared: run the formant→morph mapping and record the debug snapshot. Both drivers funnel here so
// web and native produce identical poses from identical features.
function applyFeatures(feat: AcousticFeatures, debug: VenusLipsync['debug']): VisemeWeights {
  const w = mapFeaturesToWeights(feat);
  debug.rms = feat.rms;
  debug.f1 = feat.f1;
  debug.f2 = feat.f2;
  debug.centroid = feat.f2; // legacy field — repurposed to show F2 (front/back axis)
  debug.hfRatio = feat.hf;
  debug.viseme = dominantMorph(w);
  return w;
}

// ─── web driver: Web-Audio AnalyserNode → our shared formant model ───────────────────────────────
class AnalyserDriver implements VenusLipsync {
  private ctx: AudioContext;
  private analyser: AnalyserNode;
  private time: Float32Array<ArrayBuffer>;
  private srcEl: HTMLMediaElement | null = null;
  private srcNode: MediaElementAudioSourceNode | MediaStreamAudioSourceNode | null = null;
  debug = { viseme: 'viseme_sil', rms: 0, centroid: 0, hfRatio: 0, f1: 0, f2: 0 };

  constructor(fftSize = 1024) {
    const AC: typeof AudioContext =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AC();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = fftSize; // 1024 time-domain samples per frame for our extractor
    this.time = new Float32Array(this.analyser.fftSize);
  }

  resume() {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  connect(el: HTMLMediaElement) {
    this.resume();
    if (this.srcEl === el) return; // idempotent: one source node per element
    this.srcEl = el;
    // NOTE: createMediaElementSource may throw if the element was already routed through another
    // AudioContext — guard so a re-render can't crash.
    try {
      const node = this.ctx.createMediaElementSource(el);
      node.connect(this.analyser);
      this.analyser.connect(this.ctx.destination); // keep audio audible
      this.srcNode = node;
    } catch (e) {
       
      console.warn('[venus-lipsync] connect failed (already routed?)', e);
    }
  }

  async connectMicrophone() {
    this.resume();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const node = this.ctx.createMediaStreamSource(stream);
    node.connect(this.analyser); // do NOT connect mic to destination (feedback)
    this.srcNode = node;
  }

  sample(): VisemeWeights {
    this.analyser.getFloatTimeDomainData(this.time);
    const feat = analyzeWindow(this.time, this.ctx.sampleRate);
    return applyFeatures(feat, this.debug);
  }

  dispose() {
    try { this.srcNode?.disconnect(); } catch {}
    try { this.analyser.disconnect(); } catch {}
    void this.ctx.close();
  }
}

// Web Audio API present? It's web-only — React Native has no AudioContext, so the AnalyserNode path
// (which does `new AudioContext()`) would crash with "Cannot read property 'prototype' of undefined".
function hasWebAudio(): boolean {
  return typeof window !== 'undefined' && !!((window as any).AudioContext || (window as any).webkitAudioContext);
}

// ─── native driver: drives the mouth from Venus's REAL spoken audio ──────────────────────────────
// React Native has no Web Audio AnalyserNode, but live-voice.ts decodes Gemini's PCM and feeds a
// time-synced FORMANT envelope into venus-speech-level.ts (the FFT runs there, at push time, off the
// render loop). This reads the features audible right now and maps them with the SAME mapper as web.
class SpeechLevelDriver implements VenusLipsync {
  debug = { viseme: 'viseme_sil', rms: 0, centroid: 0, hfRatio: 0, f1: 0, f2: 0 };
  connect() {}
  async connectMicrophone() {}
  resume() {}
  dispose() {}
  speaking(): boolean {
    return speechActiveAt();
  }
  sample(): VisemeWeights {
    return applyFeatures(speechFrameAt(), this.debug);
  }
}

// ─── factory ─────────────────────────────────────────────────────────────────
export function createVenusLipsync(): VenusLipsync {
  // Native (no Web Audio): drive the mouth from the real spoken-audio formant envelope (live-voice).
  if (!hasWebAudio()) return new SpeechLevelDriver();
  if (USE_WAWA) {
    try {
      // Optional path. Only reached if you set USE_WAWA = true AND installed the package. require()
      // (not import) keeps Metro from trying to resolve it at bundle time when the dep is absent.
       
      const wawa = require('wawa-lipsync');
      return new WawaDriver(wawa.Lipsync, wawa.VISEMES);
    } catch (e) {
       
      console.warn('[venus-lipsync] wawa-lipsync not available, using AnalyserNode', e);
    }
  }
  return new AnalyserDriver();
}

// ─── optional wawa-lipsync adapter (inert unless USE_WAWA && installed) ───────
// wawa emits a SINGLE dominant viseme whose values ARE the RPM viseme_* names, so the map is the
// identity. It does not emit jawOpen — we still derive that from an internal AnalyserDriver.
class WawaDriver implements VenusLipsync {
  private mgr: any;
  private jaw = new AnalyserDriver(1024); // jaw openness only
  debug = { viseme: 'viseme_sil', rms: 0, centroid: 0, hfRatio: 0, f1: 0, f2: 0 };

  constructor(Lipsync: any, _VISEMES: any) {
    this.mgr = new Lipsync({ fftSize: 2048, historySize: 10 });
  }
  resume() { this.jaw.resume(); }
  connect(el: HTMLMediaElement) { this.mgr.connectAudio(el); this.jaw.connect(el); }
  async connectMicrophone() { await this.mgr.connectMicrophone(); await this.jaw.connectMicrophone(); }
  sample(): VisemeWeights {
    this.mgr.processAudio();
    const w: VisemeWeights = {};
    const jawW = this.jaw.sample(); // gives jawOpen + rms debug
    const silent = this.mgr.state === 'silence' || (this.mgr.features?.volume ?? 0) < 0.08;
    if (silent) { w.viseme_sil = 1; this.debug.viseme = 'viseme_sil'; return w; }
    const active: string = this.mgr.viseme || 'viseme_sil';
    w[active] = 1;
    w.jawOpen = jawW.jawOpen ?? 0;
    this.debug = { viseme: active, rms: jawW.rms ?? 0, centroid: 0, hfRatio: 0, f1: 0, f2: 0 };
    return w;
  }
  dispose() { this.jaw.dispose(); }
}
