// src/lib/venus-speech-level.ts
//
// Time-synced amplitude envelope of Venus's SPOKEN audio, so the 3D avatar's mouth is driven by the
// REAL sound coming back from Gemini Live — not a synthetic flap. The native audio path
// (src/lib/live-voice.ts) decodes Gemini's 24 kHz PCM and enqueues it for gapless playback; as it
// does, it pushes each chunk here. The native lip-sync driver (src/lib/venus-lipsync.ts) reads
// speechFrameAt() once per render frame to set jaw/viseme targets.
//
// Pure JS, ZERO deps on purpose: both the audio layer (react-native-audio-api, Gemini SDK) and the
// avatar (three/expo-gl) import this without pulling each other's heavy modules in.
//
// How the sync works: each chunk enters the playback queue at a known wall-clock time and has a
// known duration (sample-count / 24 kHz). We slice it into ~40 ms windows, store each window's RMS
// (loudness) + zero-crossing-rate (brightness ≈ vowel vs. sibilant) against the wall-clock instant
// it will be AUDIBLE, then look up "what's playing right now" each frame. LATENCY_MS shifts the
// windows forward to compensate for output (queue + hardware) latency so the lips match the ear.

export type SpeechFrame = {
  /** Normalized loudness 0..1 (RMS of the window). 0 ⇒ silent. */
  level: number;
  /** Zero-crossing rate 0..1 — low for voiced vowels, high for fricatives/sibilants ("s","f"). */
  zcr: number;
};

type Seg = { t0: number; t1: number; level: number; zcr: number };

const WINDOW_MS = 40; // envelope granularity (~25 windows/sec — finer than syllables)
const KEEP_MS = 700; // drop windows older than this
const MAX_SEGS = 512; // hard cap (a long reply buffered ahead) before we force-prune

let SEG: Seg[] = [];
let lastEnd = 0; // wall-clock ms when the most-recently-queued chunk stops being audible

// Output latency: audio becomes audible a beat AFTER it's enqueued (queue + hardware buffering).
// Shift stored windows forward by this so her mouth matches what the user hears. Tune on device:
// if her lips LEAD the sound, raise it; if they LAG, lower it.
let LATENCY_MS = 120;
export function setVenusSpeechLatency(ms: number) {
  LATENCY_MS = Math.max(0, ms);
}
export function getVenusSpeechLatency() {
  return LATENCY_MS;
}

function nowMs() {
  return Date.now();
}

/**
 * Feed one decoded PCM chunk. Called by live-voice.ts for every buffer it enqueues.
 * @param pcm        Int16 mono samples (the exact buffer being played).
 * @param startAtMs  wall-clock ms when this chunk STARTS playing (= max(prevPlayEnd, now)).
 * @param durMs      its real duration (samples / sampleRate).
 */
export function pushSpeechChunk(pcm: Int16Array, startAtMs: number, durMs: number) {
  const n = pcm.length;
  if (n === 0 || durMs <= 0) return;
  const base = startAtMs + LATENCY_MS;
  const msPerSample = durMs / n;
  const winSamples = Math.max(1, Math.round(WINDOW_MS / msPerSample));

  for (let i = 0; i < n; i += winSamples) {
    const end = Math.min(n, i + winSamples);
    let sumSq = 0;
    let crossings = 0;
    let prev = pcm[i];
    for (let j = i; j < end; j++) {
      const s = pcm[j];
      const v = s / 32768;
      sumSq += v * v;
      // sign change → a zero crossing (count voiced-vs-fricative brightness, cheaply, no FFT)
      if ((s >= 0) !== (prev >= 0)) crossings++;
      prev = s;
    }
    const len = end - i;
    SEG.push({
      t0: base + i * msPerSample,
      t1: base + end * msPerSample,
      level: Math.sqrt(sumSq / len),
      zcr: crossings / len,
    });
  }
  lastEnd = Math.max(lastEnd, base + durMs);
  prune();
}

function prune() {
  const cutoff = nowMs() - KEEP_MS;
  if (SEG.length > MAX_SEGS || (SEG.length > 0 && SEG[0].t1 < cutoff)) {
    SEG = SEG.filter((s) => s.t1 >= cutoff);
  }
}

const SILENT: SpeechFrame = { level: 0, zcr: 0 };

/** What's audible right now (loudness + brightness). Returns silence when nothing is playing. */
export function speechFrameAt(t = nowMs()): SpeechFrame {
  // Segments are appended in playback order, so scan newest→oldest and stop once we pass `t`.
  for (let k = SEG.length - 1; k >= 0; k--) {
    const s = SEG[k];
    if (t >= s.t0 && t < s.t1) return { level: s.level, zcr: s.zcr };
    if (s.t1 <= t) break; // everything earlier is older than t → t sits in a gap / the future
  }
  return SILENT;
}

/** Convenience: just the loudness. */
export function speechLevelAt(t = nowMs()): number {
  return speechFrameAt(t).level;
}

/** True while real spoken audio is playing (plus a short tail so brief gaps don't blink it off). */
export function speechActiveAt(t = nowMs()): boolean {
  return lastEnd > 0 && t < lastEnd + 90;
}

/** Flush the envelope — call on barge-in/interrupt, mute, or session stop. */
export function resetSpeechLevel() {
  SEG = [];
  lastEnd = 0;
}
