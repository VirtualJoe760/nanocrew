// Gemini Live realtime voice for the Studio brand interview. The app connects DIRECTLY to the
// Gemini Live API over a WebSocket using a short-lived ephemeral token minted by
// /api/voice-live-token (the real key never touches the client). Mic audio streams up as 16kHz
// PCM; Venus's 24kHz PCM streams back and plays gaplessly. She calls a `save_brand` tool when the
// brand is ready. Replaces the turn-based /api/voice pipeline (see docs/studio/FORGE_AI.md history).
//
// Audio: react-native-audio-api (AudioRecorder for mic, AudioBufferQueueSourceNode for playback).

import {
  GoogleGenAI,
  Modality,
  type LiveServerMessage,
  type Session,
  type FunctionDeclaration,
  Type,
} from '@google/genai';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import { AudioContext, AudioRecorder, AudioBufferQueueSourceNode, AudioManager } from 'react-native-audio-api';

// WEB AUDIO-OUT (2026-08-18: "Eve isn't talking, she is responding"): react-native-audio-api's
// buffer-queue source is a NATIVE-only extension, so browsers had no player and her PCM chunks
// were dropped — captions only. This shim speaks the same surface (enqueueBuffer/clearBuffers/
// connect/start/stop) over the browser's standard Web Audio API: each chunk becomes an
// AudioBufferSourceNode scheduled on a running playhead, which is gapless enough for speech.
class WebAudioQueue {
  private playhead = 0;
  private sources = new Set<globalThis.AudioBufferSourceNode>();
  constructor(private ctx: globalThis.AudioContext) {}
  connect(_dest: unknown) {}
  start(_when: number, _offset: number) {}
  enqueueBuffer(buf: globalThis.AudioBuffer) {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    const at = Math.max(this.playhead, this.ctx.currentTime + 0.03);
    src.start(at);
    this.playhead = at + buf.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }
  clearBuffers() {
    for (const s of this.sources) { try { s.stop(); } catch { /* already ended */ } }
    this.sources.clear();
    this.playhead = 0;
  }
  stop() { this.clearBuffers(); }
}

import { apiUrl } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { type BrandResult, type ChatMessage } from '@/lib/interview';
import { VOCABULARY_BRIEF } from '@/lib/site-vocabulary';
import { pushSpeechChunk, resetSpeechLevel } from '@/lib/venus-speech-level';
import { buildPersona, personaFingerprint, EVE_PERSONA_HASH } from '@/lib/eve-persona';

// Live (speech-to-speech) system prompt — the same warm, flowing brand interview as the turn-based
// brain, but written for REAL-TIME SPEECH: no JSON contract, she just talks and calls save_brand.
function liveSystemInstruction(userName?: string, firstTime?: boolean): string {
  // Her character lives in src/eve/*.md now — see src/eve/README.md. firstTime only decides which
  // job she's on: no brands yet means the brand interview.
  return buildPersona(firstTime === false ? 'central' : 'interview', { userName });
}

/** Eve's CENTRAL persona — the home-state session for a RETURNING creator (has stores). One merged
 *  instruction, ordered by how often it's used: CONVERSATION FIRST (she's a collaborator they think
 *  out loud with — this is the default mode, not a fallback), then task awareness (the intent router
 *  transitions surfaces; docs/archive/VENUS_CENTRAL.md §3), then the brand-interview module CARRIED
 *  VERBATIM from liveSystemInstruction — which she now ENTERS for a new brand rather than being.
 *
 *  Two things to preserve when editing:
 *   1. the "ready to build your brand" cue sentence the buildReady regex (eve-home.tsx) listens for —
 *      the regex also accepts "got everything", "let's build", etc., and unlocks after 6 user turns
 *      regardless, so it's forgiving; still, don't drop the phrase.
 *   2. the DELIVERY paragraph — it's her voice, tuned against the live TTS. */
export function eveCentralInstruction(userName?: string, storeNames: string[] = []): string {
  return buildPersona('central', { userName, brands: storeNames });
}

/** Greeting nudge for the central (returning-creator) session. Deliberately NOT one fixed shape —
 *  "say hey and ask what they're up to" produced the same sentence every launch (Joe, 2026-08-18).
 *  The session appends the real context: time of day, how long they've been away, and the openers
 *  she has already used (see openerVariation below). */
export const EVE_CENTRAL_GREETING =
  "(They just tapped you. Open however feels right THIS time — one short line. It doesn't have to be a greeting-plus-question: you might just say hi, or make a dry observation, or pick up where you left off, or ask one specific thing. Never a formula, never a list of what you can do, never your job title.)";

/** The anti-sameness half of the greeting: what she's already said, plus what's actually true
 *  right now. Without this a model reaches for its single likeliest opener every session. */
export function openerVariation(recent: string[], hoursAway: number | null): string {
  const now = new Date().getHours();
  const partOfDay = now < 5 ? 'the middle of the night' : now < 12 ? 'morning' : now < 17 ? 'afternoon' : now < 22 ? 'evening' : 'late evening';
  const away =
    hoursAway == null
      ? ''
      : hoursAway < 2
        ? ' They were here minutes ago — no need to greet them like a new arrival.'
        : hoursAway < 24
          ? ` Last time was about ${hoursAway} hours ago.`
          : ` It has been about ${Math.round(hoursAway / 24)} day(s) since they were here.`;
  const avoid = recent.length
    ? ` You have ALREADY opened with these — do not reuse them or anything close to them: ${recent.slice(0, 5).map((t) => `"${t}"`).join(' / ')}.`
    : '';
  return ` (Context for your opening line only: it's ${partOfDay}.${away}${avoid} Vary the SHAPE, not just the words.)`;
}

/** Voice persona for the live-site CRITIQUE view: the creator is LOOKING at their site, circling
 *  parts of it and saying what to change, in a continuous open-mic conversation. */
export function critiqueInstruction(brandName?: string): string {
  // VOCABULARY_BRIEF is what lets her NAME the thing they just circled ("that's the hero band") —
  // generated from site-vocabulary.ts, so it rides as reference material rather than living in her
  // character files.
  return buildPersona('critique', {
    brands: brandName?.trim() ? [brandName.trim()] : [],
    reference: VOCABULARY_BRIEF,
  });
}

/** Greeting nudge for the critique view. */
export const CRITIQUE_GREETING =
  "(The creator just opened the live view of their site to edit it. In ONE short sentence, greet them and tell them to circle anything they want to change and say the adjustment — OR, if they don't know what a part is called, circle it and ask and you'll explain it and suggest changes.)";



/** EVE'S VOICE — Joe's pick (Lab audition 2026-07-05): Kore × the 'british robot' delivery. The
 *  single source: every live session defaults to it, and /api/say's VENUS_VOICE must match. The
 *  site-critique session silently ran the old 'Aoede' default for weeks because it never passed a
 *  name — that's the "why does she have a different voice" bug (2026-08-17). */
export const LIVE_VOICE = 'Kore';

const IN_RATE = 16000; // Gemini Live wants 16kHz PCM16 mono input
const OUT_RATE = 24000; // Gemini Live emits 24kHz PCM16 mono output
const VOICE_RMS = 0.015; // mic frame loudness that counts as "they're talking"
const QUIET_SETTLE_MS = 700; // silence after their last word before any queued cue may speak
const GREET_HOLD_MS = 700; // beat after setup to see whether THEY opened the conversation
const OPENING_FRAMES = 3; // mic frames of real speech that mean "they're already talking" (~0.3s)
const CUE_TTL_MS = 15_000;
const HANDOFF_TAIL_MS = 2_500; // let a displaced session finish its sentence before it's closed // a queued stage direction older than this no longer describes the screen
/** Backstop for an announcement session (speakOnly) — it closes on turnComplete, but never lives
 *  longer than this even if that signal is lost. One spoken line is a few seconds. */
const ANNOUNCE_MAX_MS = 25_000;

export type LiveState = 'connecting' | 'listening' | 'speaking' | 'thinking' | 'idle' | 'error';

/** Thrown when the iOS audio session can't be activated because another app holds it at higher
 *  priority — almost always an ACTIVE PHONE / FaceTime call (you can't grab the mic mid-call). This
 *  is distinct from a generic connection failure so the UI can show a "you're on a call — end it and
 *  come back" modal instead of a vague error. (iOS error 561017449 = '!pri' = AVAudioSession
 *  InsufficientPriority.) */
export class AudioSessionBusyError extends Error {
  constructor() {
    super('Your microphone is busy — another app (likely a phone or FaceTime call) is using it.');
    this.name = 'AudioSessionBusyError';
  }
}

/** Recognize the InsufficientPriority failure across however the native layer surfaces it (a numeric
 *  `code`, or the code/keyword inside the message string). */
function isInsufficientPriority(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === 561017449 || code === '561017449') return true;
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return /insufficient\s*priority|561017449|!pri\b/i.test(msg);
}

export interface LiveCallbacks {
  onState?: (s: LiveState) => void;
  /** The wall-clock window her QUEUED audio occupies this turn (start, end). Subtitles ride this so
   *  they follow her voice instead of the transcript stream, which lands seconds ahead of the sound
   *  (Joe, 2026-08-19: "we want it to be word for word"). */
  onSpeechWindow?: (startedAt: number, endsAt: number) => void;
  onUserTranscript?: (text: string) => void; // running input transcription
  onVenusTranscript?: (text: string) => void; // running output transcription
  onTranscript?: (messages: ChatMessage[]) => void; // full committed conversation (for the chat view)
  onBrand?: (brand: BrandResult) => void; // she called save_brand
  onError?: (msg: string) => void;
}

// The tool Venus calls when she has everything — mirrors the BrandResult shape from the prompt.
const SAVE_BRAND: FunctionDeclaration = {
  name: 'save_brand',
  description: 'Call this ONCE when you have everything you need, to finalize the brand and end the interview.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING },
      tagline: { type: Type.STRING },
      mission: { type: Type.STRING },
      audience: { type: Type.STRING },
      voice: { type: Type.STRING },
      story: { type: Type.STRING },
      vibeKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
      designStyle: { type: Type.STRING, description: 'minimalist | bold | elegant | extravagant | street' },
      products: { type: Type.ARRAY, items: { type: Type.STRING } },
      siteNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
      logoExists: { type: Type.BOOLEAN },
      logoDirection: { type: Type.STRING },
      palette: {
        type: Type.ARRAY,
        description: 'exactly 5: primary, secondary, accent, background, text',
        items: { type: Type.OBJECT, properties: { role: { type: Type.STRING }, hex: { type: Type.STRING } } },
      },
      displayFont: { type: Type.STRING },
      bodyFont: { type: Type.STRING },
    },
    required: ['name', 'designStyle', 'products'],
  },
};

// ---- PCM helpers ----
function base64ToInt16(b64: string): Int16Array {
  const bin = global.atob ? global.atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, Math.floor(len / 2));
}

function float32ToPcm16Base64(input: Float32Array): string {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(out.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return global.btoa ? global.btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
}

/** Map the tool args back to the BrandResult the rest of the app consumes. */
function toBrandResult(a: Record<string, unknown>): BrandResult {
  const palette = Array.isArray(a.palette) ? (a.palette as { role: string; hex: string }[]) : [];
  return {
    name: String(a.name ?? 'Untitled'),
    tagline: String(a.tagline ?? ''),
    mission: String(a.mission ?? ''),
    audience: String(a.audience ?? ''),
    voice: String(a.voice ?? ''),
    story: String(a.story ?? ''),
    vibeKeywords: (a.vibeKeywords as string[]) ?? [],
    logo: { exists: Boolean(a.logoExists), direction: String(a.logoDirection ?? '') },
    designStyle: (a.designStyle as BrandResult['designStyle']) ?? 'minimalist',
    products: (a.products as string[]) ?? [],
    siteNotes: (a.siteNotes as string[]) ?? [],
    designSystem: {
      palette,
      typography: { display: String(a.displayFont ?? ''), body: String(a.bodyFont ?? '') },
      texture: [],
      motion: [],
    },
  };
}

// Single-session guard: at most ONE Venus session is ever live across the whole app. start() kills
// any other before connecting, so her voice can never overlap itself — whether two screens both try
// to run her (studio interview ↔ site editor) or a component churns/remounts. Module-level on purpose.
let activeLiveSession: LiveVoiceSession | null = null;

/** True while a Venus session is connected/listening/speaking somewhere in the app. */
export function isVenusLive(): boolean {
  return activeLiveSession !== null;
}

export class LiveVoiceSession {
  private session: Session | null = null;
  private recorder: AudioRecorder | null = null;
  private outCtx: AudioContext | null = null;
  private queue: AudioBufferQueueSourceNode | null = null;
  private playEndsAt = 0; // wall-clock ms when her queued audio finishes — mic is gated until then
  private playStartedAt = 0; // wall-clock ms when THIS turn's audio began — the caption clock's origin
  // Per-exchange caption segmentation (transcripts arrive as fragments; reset each new turn).
  private curUser = '';
  private curVenus = '';
  private userTurnActive = false;
  // NEVER TALK OVER THEM (Joe, 2026-08-18: "she should really never cut anybody off"). The server's
  // inputTranscription lags the mic by ~0.3–0.8s, so `userTurnActive` alone leaves a window where a
  // surface cue (picker opening, design ready) fires while they're mid-sentence. These track speech
  // LOCALLY, off the mic buffer itself, so the gate closes the instant they start talking.
  private lastUserVoiceAt = 0;
  private promptTimer: ReturnType<typeof setTimeout> | null = null;
  /** Mic frames with speech in them since this session opened — tells the greeting whether the
   *  creator started the conversation themselves (Joe, 2026-08-18). */
  private openVoiceFrames = 0;
  private greetTimer: ReturnType<typeof setTimeout> | null = null;
  private transcript: { role: 'user' | 'assistant'; text: string }[] = [];

  /** The full conversation so far — used to extract the brand (native audio won't call the tool). */
  getTranscript() {
    return this.transcript.slice();
  }
  private cb: LiveCallbacks;
  private token: string;
  private accessToken: string;
  private userName?: string;
  private firstTime?: boolean;
  private voiceName: string;
  private closed = false;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private muted = false;

  /** Text-only (keyboard chat) mode: mute the mic AND her audio playback — it's a text experience.
   *  Muting mid-reply also flushes any queued audio so she goes quiet immediately. */
  setMuted(m: boolean) {
    this.muted = m;
    if (m) {
      try { this.queue?.clearBuffers(); } catch {}
      this.playEndsAt = 0;
      this.playStartedAt = 0;
      resetSpeechLevel();
    }
  }

  // Override the persona/tool/greeting so the SAME session can serve other voice flows (e.g. editing
  // an existing site) instead of only the brand interview.
  private instructionOverride?: string;
  private greetingOverride?: string;
  /** Appended to the greeting nudge: recent openers + real context, so she doesn't repeat herself. */
  private variation?: string;
  private enableBrandTool: boolean;
  /** Speak first on connect. FALSE when the socket is being re-opened underneath an ongoing
   *  conversation (a reconnect after a suspend expired) — she should pick up, not re-introduce
   *  herself. The Eve tab only passes true when the creator has just asked her to talk. */
  private greetOnOpen: boolean;
  /** ANNOUNCEMENT MODE: say one line in her real voice, then close. The microphone is never
   *  started, so this is not a conversation and nothing is listening — it exists because a
   *  one-shot TTS model renders the same voice NAME as a different person, and the launch line
   *  has to sound like the Eve the creator just spent five minutes talking to. */
  private speakOnly: boolean;
  private announceDone = false; // announcement close scheduled once
  private announceCap: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: {
    accessToken: string;
    userName?: string;
    firstTime?: boolean;
    voiceName?: string;
    instruction?: string;
    greeting?: string;
    /** Recent openers + situational context, appended to the greeting so she varies (eve-openers). */
    variation?: string;
    enableBrandTool?: boolean;
    greetOnOpen?: boolean;
    speakOnly?: boolean;
    callbacks: LiveCallbacks;
  }) {
    this.accessToken = opts.accessToken;
    this.userName = opts.userName;
    this.firstTime = opts.firstTime;
    this.voiceName = opts.voiceName ?? LIVE_VOICE; // one Eve, one voice — a session that forgets to pass a name must not sound like someone else
    this.instructionOverride = opts.instruction;
    this.greetingOverride = opts.greeting;
    this.variation = opts.variation;
    this.enableBrandTool = opts.enableBrandTool ?? true;
    this.greetOnOpen = opts.greetOnOpen ?? true;
    this.speakOnly = opts.speakOnly ?? false;
    this.cb = opts.callbacks;
    this.token = '';
  }

  // Activate the iOS audio session, tolerating transient InsufficientPriority (code 561017449 =
  // '!pri'). iOS rejects activation when another session still holds priority — most often our OWN
  // expo-audio TTS path a beat earlier, or another app's audio yielding — but it clears in a few
  // hundred ms. A single failure used to kill the whole connection (the "Failed to activate audio
  // session" banner); retry with a short backoff so the common transient case just recovers.
  private async activateAudioSession(): Promise<void> {
    const delays = [0, 150, 400, 900];
    let lastErr: unknown = null;
    for (let i = 0; i < delays.length; i++) {
      if (delays[i]) await new Promise((res) => setTimeout(res, delays[i]));
      if (this.closed) return; // the user dismissed / navigated away mid-retry
      try {
        await AudioManager.setAudioSessionActivity(true);
        if (i > 0) console.warn(`[live] audio session activated on retry ${i}`);
        return;
      } catch (e) {
        lastErr = e;
        console.warn(`[live] audio session activate attempt ${i + 1}/${delays.length} failed:`, e instanceof Error ? e.message : e);
      }
    }
    // Persistent failure after the backoff. If it's InsufficientPriority, the mic is genuinely held by
    // another app (an active call) — surface the dedicated busy error so the UI can tell them to end
    // the call and come back, rather than a generic "couldn't connect".
    if (isInsufficientPriority(lastErr)) throw new AudioSessionBusyError();
    throw lastErr instanceof Error ? lastErr : new Error('Could not activate the audio session');
  }

  async start() {
    // Enforce the single-session rule: tear down any OTHER live session first so two of her can't talk
    // at once. (Our own session is a no-op re-entry — the hook guards double-start separately.)
    if (activeLiveSession && activeLiveSession !== this) {
      // A second surface taking the session used to chop her mid-word (Joe, 2026-08-18: "she
      // responded, got cut off, then responded in a different voice" — the critique view mounting
      // over a live conversation). Let the sentence she's already speaking play out, capped so a
      // handoff never feels stuck.
      const prev = activeLiveSession;
      const tail = Math.min(Math.max(0, prev.playEndsAt - Date.now()), HANDOFF_TAIL_MS);
      if (tail > 0) {
        console.warn(`[live] handing the session over — letting her finish (${tail}ms)`);
        await new Promise((res) => setTimeout(res, tail));
      }
      try { prev.stop(); } catch {}
    }
    activeLiveSession = this;
    this.closed = false;
    this.openVoiceFrames = 0; // fresh session: nobody has spoken into it yet
    this.cb.onState?.('connecting');
    // Watchdog: if we never reach "ws open" (audio session wedged, token expiry, network), surface a
    // retry instead of sitting on "thinking…" forever. Cleared in onopen; re-armed each start().
    this.armWatchdog();
    // 1. mint the ephemeral token — with a FRESH auth token (supabase-js pauses auto-refresh in
    // hidden/unfocused web tabs, so the constructor's token can be expired; 2026-08-18).
    let auth = this.accessToken;
    try {
      const { data } = await supabase.auth.getSession();
      auth = data.session?.access_token ?? auth;
    } catch { /* fall back to the constructor token */ }
    const r = await fetch(apiUrl('/api/voice-live-token'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth}` },
    });
    const d = (await r.json()) as { token?: string; model?: string; error?: string };
    // If stop() ran while the token was minting (e.g. the overlay transitioned home→developing and a
    // NEW session already claimed activeLiveSession), abort here — otherwise we build a second audio
    // graph + socket that nothing references, and two of her fight the mic. The singleton kill at the
    // top of start() runs ONCE and can't cover an in-flight start, so every await needs this guard.
    if (this.closed) return;
    console.warn(`[live] token status=${r.status} hasToken=${!!d.token} model=${d.model ?? '-'} err=${d.error ?? '-'}`);
    if (!d.token || !d.model) throw new Error(d.error || `token failed (${r.status})`);
    this.token = d.token;

    // 2. audio output graph (24kHz, gapless queue)
    // iOS audio session: play AND record at once, route to the SPEAKER (not earpiece), and use
    // voiceChat mode for echo cancellation so Venus doesn't hear her own voice. Without this,
    // recording forces the session into a mode where her playback is silent / earpiece-only.
    console.warn('[live] configuring audio session');
    // SIMULATOR (2026-08-18): voiceChat mode runs the voice-processing IO unit, which is silent
    // in the iOS Simulator — she "spoke" into the void on the dev rig. Plain default mode there;
    // real devices keep voiceChat for echo cancellation. (The half-duplex playEndsAt gate still
    // stops most self-hearing on the sim.)
    const simulator = Platform.OS === 'ios' && !Device.isDevice;
    AudioManager.setAudioSessionOptions({
      iosCategory: 'playAndRecord',
      iosMode: simulator ? 'default' : 'voiceChat',
      iosOptions: ['defaultToSpeaker', 'allowBluetoothHFP'],
    });
    await this.activateAudioSession();
    if (this.closed) return; // stopped during the audio-session backoff — don't build a dead graph

    console.warn('[live] A: new AudioContext');
    // WEB: the browser's own AudioContext (created inside the tap's gesture chain, so autoplay
    // policy allows it) — the library's web context has no queue source to drive it anyway.
    this.outCtx = Platform.OS === 'web'
      ? (new (globalThis.AudioContext)({ sampleRate: OUT_RATE }) as unknown as AudioContext)
      : new AudioContext({ sampleRate: OUT_RATE });
    // resume() can hang on a contended iOS audio session (e.g. one leaked by a previous JS reload).
    // RN audio contexts usually start 'running', so resume is a formality — don't let it wedge us.
    await Promise.race([
      this.outCtx.resume().catch(() => {}),
      new Promise<void>((res) => setTimeout(res, 2500)),
    ]);
    console.warn('[live] B: createBufferQueueSource');
    // react-native-audio-api's WEB build has no buffer-queue source (native-only extension). Without
    // this guard the throw killed start() before the socket ever opened, so Eve was dead in browsers
    // even for typed chat. Degrade instead: no audio-out → her replies land as captions/chat only
    // (every downstream this.queue use is already null-guarded).
    try {
      this.queue = this.outCtx.createBufferQueueSource();
      console.warn('[live] C: connect to destination');
      this.queue.connect(this.outCtx.destination);
      console.warn('[live] D: queue.start(0, 0)');
      this.queue.start(0, 0); // both when AND offset must be finite numbers, not undefined
      console.warn('[live] E: audio graph ready → connecting…');
    } catch (e) {
      if (Platform.OS === 'web') {
        this.queue = new WebAudioQueue(this.outCtx as unknown as globalThis.AudioContext) as unknown as AudioBufferQueueSourceNode;
        console.warn('[live] web audio-out shim active — she speaks through the browser');
      } else {
        this.queue = null;
        console.warn('[live] no audio-out on this platform — captions only:', e instanceof Error ? e.message : e);
      }
    }

    // 3. connect to Gemini Live with the ephemeral token (client → Gemini directly)
    const ai = new GoogleGenAI({ apiKey: this.token, httpOptions: { apiVersion: 'v1alpha' } });
    // CHAIN OF CUSTODY: log what is actually going on the wire — the hash of the markdown this
    // bundle was built from, plus a fingerprint and length of the composed instruction. A stale
    // bundle or a dropped file becomes provable instead of suspected (src/eve/README.md).
    const instruction = this.instructionOverride ?? liveSystemInstruction(this.userName, this.firstTime);
    // voice + output rate ride the same line as the persona hash: "she sounded like someone else for
    // a second" (Joe, 2026-08-19) is either a different voice NAME or a resampled graph, and neither
    // was provable from the old log. Now both are on the wire next to which instruction she got.
    console.warn(
      `[live] persona files=${EVE_PERSONA_HASH} sent=${personaFingerprint(instruction)} chars=${instruction.length} voice=${this.voiceName} outRate=${this.outCtx?.sampleRate ?? '-'}/${OUT_RATE}`,
    );
    this.session = await ai.live.connect({
      model: d.model,
      callbacks: {
        onopen: () => {
          this.clearWatchdog();
          if (this.speakOnly) {
            // No recorder, ever. She says her line and we close — nothing is listening.
            console.warn('[live] ws open → announcement (mic never started)');
            this.cb.onState?.('speaking');
            // Hard cap: if turnComplete never lands (dropped frame, model stall), the socket still
            // closes. An announcement must never become an open-ended connection.
            this.announceCap = setTimeout(() => { void this.stop(); }, ANNOUNCE_MAX_MS);
            return;
          }
          console.warn('[live] ws open → starting mic');
          // A healthy stretch re-arms the one automatic reconnect. The counter used to latch
          // after the first drop, so the SECOND drop — even an hour later — left her silently
          // dead (BUG_AUDIT_2026-08-20). 15s connected = healthy; a reconnect that dies before
          // that keeps the latch, so a flapping socket still can't loop forever.
          if (this.healthTimer) clearTimeout(this.healthTimer);
          this.healthTimer = setTimeout(() => { this.reconnects = 0; }, 15_000);
          this.startMic();
        },
        onmessage: (m) => this.onMessage(m),
        onerror: (e: ErrorEvent) => {
          console.warn('[live] ws error', e?.message);
          this.fail(e.message || 'connection error');
        },
        onclose: (e: CloseEvent) => {
          console.warn('[live] ws close', e?.code, e?.reason);
          if (this.healthTimer) { clearTimeout(this.healthTimer); this.healthTimer = null; }
          if (this.closed) return;
          // She must not silently die mid-conversation (Joe, 2026-08-17): one automatic
          // reconnect, no re-greeting, transcript intact. Repeated failures surface as idle.
          if (this.reconnects < 1) {
            this.reconnects++;
            console.warn('[live] unexpected close → reconnecting');
            this.session = null;
            this.greetOnOpen = false;
            void this.start().catch(() => this.cb.onState?.('idle'));
            return;
          }
          this.cb.onState?.('idle');
        },
      },
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: instruction,
        // NO languageCode: the native-audio model auto-detects language and REJECTS a languageCode in
        // speechConfig (it broke the session → no audio). The persona wording carries the British/
        // fashionable tone instead. Accent/voice is best locked via the voice sampler, not this field.
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voiceName } } },
        // VAD: API DEFAULTS — deliberately no realtimeInputConfig (Joe, 2026-08-18). The custom
        // block's history: wind → LOW/LOW + 1000ms (fdce068) → never settled → 650ms → too jumpy
        // in a quiet room → 850ms → START_SENSITIVITY_LOW stopped hearing him at all. Defaults
        // heard fine in every normal room; a per-session "windy mode" toggle is the right future
        // fix, not a hardcoded compromise.
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        ...(this.enableBrandTool ? { tools: [{ functionDeclarations: [SAVE_BRAND] }] } : {}),
      },
    });
    // The socket may have opened during the connect await AFTER a stop() — close it so onopen/startMic
    // never grab the mic for a session no one is tracking.
    if (this.closed) {
      try { this.session.close(); } catch {}
      this.session = null;
      return;
    }
  }

  private startMic() {
    this.cb.onState?.('listening');
    // Mic capture can be unavailable (web permission denied / no recorder impl). The session must
    // survive without it — keyboard mode still types into the same socket.
    try {
      this.startRecorder();
    } catch (e) {
      this.recorder = null;
      console.warn('[live] mic unavailable — typed turns only:', e instanceof Error ? e.message : e);
    }
  }

  private webMicStop: (() => void) | null = null;

  /** WEB mic: getUserMedia + ScriptProcessor → PCM16 → the same realtime input path. Browsers
   *  that deny the mic fall through to typed turns exactly like before (2026-08-18). */
  private async startWebMic() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: IN_RATE, echoCancellation: true, noiseSuppression: true },
    });
    const ctx = new globalThis.AudioContext({ sampleRate: IN_RATE });
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(2048, 1, 1);
    proc.onaudioprocess = (ev) => {
      if (!this.session || this.muted) return;
      if (Date.now() < this.playEndsAt + 250) return; // half-duplex, same as native
      const ch = ev.inputBuffer.getChannelData(0);
      this.noteUserVoice(ch);
      const data = float32ToPcm16Base64(ch);
      try {
        this.session.sendRealtimeInput({ audio: { data, mimeType: `audio/pcm;rate=${IN_RATE}` } });
      } catch { /* socket closing */ }
    };
    src.connect(proc);
    proc.connect(ctx.destination);
    this.webMicStop = () => {
      try { proc.disconnect(); src.disconnect(); } catch { /* torn down */ }
      for (const t of stream.getTracks()) t.stop();
      void ctx.close().catch(() => {});
      this.webMicStop = null;
    };
    console.warn('[live] web mic active — she hears through the browser');
  }

  private startRecorder() {
    if (Platform.OS === 'web') {
      void this.startWebMic().catch((e) => {
        console.warn('[live] mic unavailable — typed turns only:', e instanceof Error ? e.message : e);
      });
      return;
    }
    this.recorder = new AudioRecorder();
    this.recorder.onAudioReady({ sampleRate: IN_RATE, bufferLength: 1600, channelCount: 1 }, (ev) => {
      if (!this.session) return;
      if (this.muted) return; // text-only (keyboard) mode — don't pick up the room
      // Half-duplex: don't stream the mic while Venus's audio is still playing (+250ms tail),
      // otherwise her voice loops back through the speaker as "user speech" and she interrupts
      // herself. She finishes, then the mic opens for your turn.
      if (Date.now() < this.playEndsAt + 250) return;
      const ch = ev.buffer.getChannelData(0);
      this.noteUserVoice(ch);
      const data = float32ToPcm16Base64(ch);
      try {
        this.session.sendRealtimeInput({ audio: { data, mimeType: `audio/pcm;rate=${IN_RATE}` } });
      } catch {
        /* socket closing */
      }
    });
    this.recorder.start();
  }

  private onMessage(m: LiveServerMessage) {
    // Diagnostic (skip the high-frequency audio chunks so the log stays readable)
    if (!m.serverContent?.modelTurn) {
      console.warn('[live] msg', JSON.stringify(Object.keys(m)), m.serverContent ? `sc:${Object.keys(m.serverContent).join(',')}` : '');
    }
    // Setup is done — NOW it's safe to nudge Venus to open the conversation.
    if (m.setupComplete) {
      // A reconnect underneath a conversation already in progress must NOT re-greet — she'd
      // introduce herself again mid-thread. Only an intentional "start talking" greets.
      if (!this.greetOnOpen) {
        console.warn('[live] setupComplete → resumed, no greeting');
        return;
      }
      // DON'T GREET OVER THEM (Joe, 2026-08-18: he tapped and said "time we create another
      // store"; she began answering — "hey Joe, another…" — and then this greeting, sent as its
      // own completed turn, preempted her own reply and she restarted with the canned hello).
      // If they opened the conversation, answering IS the greeting. Wait a beat first, because
      // setup completes within milliseconds of the mic starting — their first words are still
      // in flight at this point.
      console.warn('[live] setupComplete → greeting (holding a beat)');
      const first = this.userName?.trim().split(/\s+/)[0];
      const hi = first ? `Hi ${first}` : 'Hi';
      const nudge = this.greetingOverride
        ? this.greetingOverride
        : this.firstTime
        ? `(Their FIRST time here. One short sentence: "${hi}" — you're Eve, and you'll get their store up and running together. Then ONE easy question. Two sentences total, then stop and listen.)`
        : `(Greet them: "${hi}" plus ONE easy question — a dozen words total. Nothing else, then stop and listen.)`;
      const opener = `${nudge}${this.variation ?? ''}`;
      if (this.greetTimer) clearTimeout(this.greetTimer);
      this.greetTimer = setTimeout(() => {
        this.greetTimer = null;
        if (this.closed) return;
        if (this.creatorOpened()) {
          console.warn('[live] greeting skipped — they opened the conversation');
          return;
        }
        try {
          this.session?.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: opener }] }],
            turnComplete: true,
          });
        } catch (e) {
          console.warn('[live] greeting send failed', e instanceof Error ? e.message : e);
        }
      }, GREET_HOLD_MS);
      return;
    }
    const sc = m.serverContent;
    // interruption — user spoke over Venus; flush her queued audio immediately
    if (sc?.interrupted) {
      this.queue?.clearBuffers();
      this.playEndsAt = 0; // her audio is gone — reopen the mic
      this.playStartedAt = 0;
      resetSpeechLevel(); // her queued audio was flushed → close her mouth at once
      this.cb.onState?.('listening');
    }
    // streamed audio out → it lives in modelTurn.parts[].inlineData.data (base64 PCM 24k), not m.data.
    // In text-only (keyboard) mode we skip playback entirely — the transcript below still streams.
    const parts = this.muted ? [] : sc?.modelTurn?.parts ?? [];
    for (const part of parts) {
      const b64 = part.inlineData?.data;
      if (!b64 || !this.outCtx || !this.queue) continue;
      try {
        const pcm = base64ToInt16(b64);
        if (pcm.length > 0) {
          const buf = this.outCtx.createBuffer(1, pcm.length, OUT_RATE);
          const f = buf.getChannelData(0);
          for (let i = 0; i < pcm.length; i++) f[i] = pcm[i] / 32768;
          this.queue.enqueueBuffer(buf);
          // Extend the "she's still talking" window by this chunk's real duration (chunks arrive
          // faster than realtime, so accumulate from whichever is later: now or the prior end).
          const durMs = (pcm.length / OUT_RATE) * 1000;
          const startAt = Math.max(this.playEndsAt, Date.now()); // wall-clock this chunk starts playing
          if (!this.playEndsAt) this.playStartedAt = startAt; // first chunk of the turn — the clock's origin
          this.playEndsAt = startAt + durMs;
          this.cb.onSpeechWindow?.(this.playStartedAt, this.playEndsAt);
          // Feed the lip-sync envelope: this exact PCM, aligned to when it becomes audible, so the
          // avatar's mouth tracks the real sound (loudness → jaw, brightness → vowel vs. sibilant).
          pushSpeechChunk(pcm, startAt, durMs);
          this.cb.onState?.('speaking');
        }
      } catch (e) {
        console.warn('[live] audio enqueue failed', e instanceof Error ? e.message : e);
      }
    }
    // Your speech: first fragment of a NEW user turn resets the accumulators, but her LAST LINE
    // STAYS ON SCREEN (Joe, 2026-08-18: mic noise/echo fired this instantly, so subtitles vanished
    // before they could be read — the "you >" line carries the user's words; her caption is only
    // replaced when her NEXT reply starts streaming).
    if (sc?.inputTranscription?.text) {
      if (!this.userTurnActive) {
        this.userTurnActive = true;
        this.curUser = '';
        this.curVenus = '';
      }
      this.curUser += sc.inputTranscription.text;
      this.cb.onUserTranscript?.(this.curUser);
    }
    // Venus replying → the user's turn is over; record it, then accumulate her reply.
    if (sc?.outputTranscription?.text) {
      if (this.userTurnActive && this.curUser.trim()) {
        this.transcript.push({ role: 'user', text: this.curUser.trim() });
        this.cb.onTranscript?.(this.getTranscript());
      }
      this.userTurnActive = false;
      this.curVenus += sc.outputTranscription.text;
      this.cb.onVenusTranscript?.(this.curVenus);
    }
    if (sc?.turnComplete && this.pendingPrompt) this.flushPrompt();
    if (sc?.turnComplete) {
      if (this.curVenus.trim()) {
        this.transcript.push({ role: 'assistant', text: this.curVenus.trim() });
        this.cb.onTranscript?.(this.getTranscript());
        this.curVenus = '';
      }
      if (this.speakOnly) {
        // Generation is done but her audio is still queued — close once it has actually played out,
        // or we cut her off mid-word. `playEndsAt` is the wall-clock end of the queued audio.
        if (!this.announceDone) {
          this.announceDone = true;
          const wait = Math.max(0, this.playEndsAt - Date.now()) + 400;
          setTimeout(() => { void this.stop(); }, wait);
        }
        return;
      }
      this.cb.onState?.('listening');
    }

    // tool call → finalize the brand
    const calls = m.toolCall?.functionCalls ?? [];
    for (const c of calls) {
      if (c.name === 'save_brand' && c.args) {
        this.cb.onBrand?.(toBrandResult(c.args as Record<string, unknown>));
        try {
          this.session?.sendToolResponse({ functionResponses: [{ id: c.id, name: c.name, response: { ok: true } }] });
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** Keyboard fallback — send a typed answer into the same Live session (she replies with audio). */
  sendText(text: string) {
    const t = text.trim();
    if (!t) return;
    try {
      this.session?.sendClientContent({ turns: [{ role: 'user', parts: [{ text: t }] }], turnComplete: true });
      this.curUser = '';
      this.curVenus = '';
      this.userTurnActive = false; // typed turn submitted → her reply accumulates next
      this.transcript.push({ role: 'user', text: t });
      this.cb.onTranscript?.(this.getTranscript());
      this.cb.onUserTranscript?.(t);
      this.cb.onVenusTranscript?.('');
      this.cb.onState?.('thinking');
    } catch (e) {
      console.warn('[live] sendText failed', e instanceof Error ? e.message : e);
    }
  }

  /** Make her SPEAK now: an instruction sent as a completed turn, so the model replies out loud.
   *  Unlike sendText it leaves no trace in the visible transcript — the creator hears her ask,
   *  they never see the stage direction. This is what the wheel's ask-spokes use; sendContext
   *  (below) can never voice anything, which is exactly why it exists and why this also must. */
  private pendingPrompt: string | null = null;
  /** When the queued cue stops being true. Stage directions describe what's ON SCREEN NOW ("the
   *  placement editor just opened"); if the creator talks for half a minute the cue is stale and
   *  saying it late is worse than not saying it (audit 2026-08-18). */
  private pendingPromptAt = 0;
  /** Fires when the queued cue is dispatched — lets a caller time a surface to her voice. */
  private pendingPromptSent?: () => void;
  private reconnects = 0;
  /** Armed on ws open; fires after 15s of sustained connection → re-arms the auto-reconnect. */
  private healthTimer: ReturnType<typeof setTimeout> | null = null;

  /** Mic frame → is there speech in it? RMS over the raw float buffer; called only OUTSIDE her own
   *  playback window, so her voice coming back through the speaker never reads as the creator. */
  private noteUserVoice(frame: Float32Array) {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    if (Math.sqrt(sum / frame.length) > VOICE_RMS) {
      this.lastUserVoiceAt = Date.now();
      this.openVoiceFrames++;
    }
  }

  /** Did the creator open this session by talking? Sustained mic speech, a live turn, or words
   *  already transcribed — any of the three means she should answer, not greet. */
  private creatorOpened(): boolean {
    return this.userTurnActive || this.curUser.trim().length > 0 || this.openVoiceFrames >= OPENING_FRAMES;
  }

  /** True while the creator holds the floor: a server-confirmed turn, or mic energy inside the
   *  settle window (covers the transcription lag AND their thinking pauses mid-sentence). */
  private creatorHasFloor(): boolean {
    return this.userTurnActive || Date.now() - this.lastUserVoiceAt < QUIET_SETTLE_MS;
  }

  prompt(text: string, onSent?: () => void) {
    const t = text.trim();
    if (!t) { onSent?.(); return; }
    // NEVER barge in: a completed turn sent during their speech commits/cancels their in-flight
    // utterance (2026-08-17: "she died when the picker opened"; 2026-08-18: she talked over him
    // as the catalogue opened). Queue it and wait for actual quiet — however long that takes.
    // One slot on purpose: a newer cue always describes the screen better than an older one. The
    // displaced caller is still released so its surface never hangs waiting.
    this.pendingPromptSent?.();
    this.pendingPrompt = t;
    this.pendingPromptAt = Date.now();
    this.pendingPromptSent = onSent;
    this.flushPrompt();
  }

  /** Send the queued cue the moment the creator is done — re-arming until they are. */
  private flushPrompt() {
    if (this.promptTimer) { clearTimeout(this.promptTimer); this.promptTimer = null; }
    if (!this.pendingPrompt) return;
    if (Date.now() - this.pendingPromptAt > CUE_TTL_MS) {
      console.warn('[live] cue expired unspoken — the screen moved on');
      this.pendingPrompt = null;
      const stale = this.pendingPromptSent;
      this.pendingPromptSent = undefined;
      stale?.(); // release the surface anyway
      return;
    }
    if (this.creatorHasFloor()) {
      this.promptTimer = setTimeout(() => { this.promptTimer = null; this.flushPrompt(); }, 200);
      return;
    }
    const t = this.pendingPrompt;
    const done = this.pendingPromptSent;
    this.pendingPrompt = null;
    this.pendingPromptSent = undefined;
    try {
      this.session?.sendClientContent({ turns: [{ role: 'user', parts: [{ text: t }] }], turnComplete: true });
      this.cb.onState?.('thinking');
    } catch {
      /* socket closing — best-effort */
    }
    done?.(); // even on a dead socket: the caller's surface must never be stranded shut
  }

  /** Push SILENT context into the session — `turnComplete:false` appends to the pending turn WITHOUT
   *  triggering a reply, so the next thing the creator says/types is answered with this context in
   *  hand. The critique view uses it to tell Venus which section was just circled (so "what's this?"
   *  is answered correctly). No transcript/state churn — it's invisible to the creator. */
  sendContext(text: string) {
    const t = text.trim();
    if (!t) return;
    try {
      this.session?.sendClientContent({ turns: [{ role: 'user', parts: [{ text: t }] }], turnComplete: false });
    } catch {
      /* socket closing — context is best-effort */
    }
  }

  /** Show her an IMAGE mid-conversation (a design she just made, a product shot).
   *
   *  Deliberately `sendClientContent` and not `sendRealtimeInput`: realtime input is the streaming
   *  path for the mic, whereas this is a one-shot turn part — the same mechanism sendContext already
   *  proves works on this session. `turnComplete:false` so it joins her context without forcing a
   *  reply; the caller decides whether to prompt her.
   *
   *  Cost: an image is ~1.3k input tokens (~$0.004 at $3/1M). Send a SETTLED image once — never per
   *  frame, and never on every edit keystroke. */
  sendImage(base64: string, mimeType: string, note?: string) {
    if (!base64) return;
    try {
      const parts: { text?: string; inlineData?: { data: string; mimeType: string } }[] = [
        { inlineData: { data: base64, mimeType } },
      ];
      if (note?.trim()) parts.push({ text: note.trim() });
      this.session?.sendClientContent({ turns: [{ role: 'user', parts }], turnComplete: false });
    } catch {
      /* socket closing — best-effort, same as sendContext */
    }
  }

  private fail(msg: string) {
    this.clearWatchdog();
    this.cb.onError?.(msg);
    this.cb.onState?.('error');
  }

  private armWatchdog() {
    this.clearWatchdog();
    this.watchdog = setTimeout(() => {
      if (this.closed) return;
      console.warn('[live] watchdog: never connected (15s) — failing for retry');
      this.fail("Eve couldn't connect — tap to try again.");
      this.stop();
    }, 15000);
  }

  private clearWatchdog() {
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  async stop() {
    this.closed = true;
    if (activeLiveSession === this) activeLiveSession = null; // release the single-session slot
    this.clearWatchdog();
    if (this.announceCap) { clearTimeout(this.announceCap); this.announceCap = null; }
    resetSpeechLevel(); // no more audio → the avatar's mouth rests

    if (this.promptTimer) { clearTimeout(this.promptTimer); this.promptTimer = null; }
    if (this.greetTimer) { clearTimeout(this.greetTimer); this.greetTimer = null; }
    this.pendingPrompt = null;
    const stranded = this.pendingPromptSent;
    this.pendingPromptSent = undefined;
    stranded?.();
    try {
      this.recorder?.stop();
      this.webMicStop?.();
    } catch {}
    try {
      this.queue?.stop();
      this.outCtx?.close();
    } catch {}
    try {
      this.session?.close();
    } catch {}
    // Release the iOS audio session so the NEXT start() isn't contended (a leaked active session is
    // the most likely cause of resume() hanging on reconnect).
    try {
      AudioManager.setAudioSessionActivity(false);
    } catch {}
    this.recorder = null;
    this.queue = null;
    this.outCtx = null;
    this.session = null;
    this.cb.onState?.('idle');
  }
}

/**
 * ANNOUNCE — say one line in Eve's REAL voice, then close.
 *
 * Why this exists rather than `/api/say`: that route is a one-shot TTS model
 * (`gemini-2.5-flash-preview-tts`) while the conversation runs on native-audio. The same voice NAME
 * renders as a different person across the two engines, so the launch line sounded like a stranger
 * right after five minutes of talking to her. Generating through the Live model is the only way to
 * match her, so an announcement is a Live session that never opens the microphone and closes itself
 * as soon as she has finished speaking.
 *
 * Fire-and-forget: a failed announcement must never block or break the flow that triggered it.
 */
export async function announce(accessToken: string, text: string, voiceName?: string): Promise<void> {
  const s = new LiveVoiceSession({
    accessToken,
    voiceName,
    instruction:
      'You are Eve. Say EXACTLY the line you are given, once, warmly and briefly. Add nothing, ask nothing.',
    greeting: `(Say exactly this, and nothing else: "${text}")`,
    enableBrandTool: false,
    speakOnly: true,
    callbacks: {},
  });
  try {
    await s.start();
  } catch {
    void s.stop();
  }
}
