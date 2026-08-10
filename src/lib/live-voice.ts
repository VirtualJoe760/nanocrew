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
import { AudioContext, AudioRecorder, AudioBufferQueueSourceNode, AudioManager } from 'react-native-audio-api';

import { apiUrl } from '@/lib/api';
import { type BrandResult, type ChatMessage } from '@/lib/interview';
import { VOCABULARY_BRIEF } from '@/lib/site-vocabulary';
import { pushSpeechChunk, resetSpeechLevel } from '@/lib/venus-speech-level';

// Live (speech-to-speech) system prompt — the same warm, flowing brand interview as the turn-based
// brain, but written for REAL-TIME SPEECH: no JSON contract, she just talks and calls save_brand.
function liveSystemInstruction(userName?: string, firstTime?: boolean): string {
  const first = userName?.trim().split(/\s+/)[0];
  const hi = first ? `"Hi ${first}"` : `"Hi"`;
  const opening = firstTime
    ? `This is their very FIRST time here, so open by briefly introducing yourself: you're Eve, their AI brand consultant, and you'll help them design their clothing brand and spin up their whole store and website — just by talking it through together. Keep that to one warm sentence. Then greet them: say ${hi}, ask how their day is going, and ask if they want to talk branding their store.`
    : `Open by greeting them warmly: say ${hi}, ask how their day is going, and ask if they want to talk branding their store.`;
  return `You are EVE — Nano Crew's warm AI brand consultant, talking OUT LOUD in real time with a creator starting a clothing brand. DELIVERY (how you SOUND, always): speak as a refined female British AI — a crisp received-pronunciation accent with a precise, calm, subtly robotic cadence, perfectly articulated, with quiet dry warmth. You're a fashionable, effortlessly stylish intelligence — elegant and tasteful, never stuffy or posh-for-its-own-sake. Short natural spoken sentences, composed and measured, never rushed. No lists, no markdown, and NEVER read JSON, field names, or hex codes aloud — just talk like a person.

${opening} Keep the open to a sentence or two — don't dump questions. Then have a real CONVERSATION: react to what they say with something specific and genuine, then ask ONE question that flows from it. QUESTION DISCIPLINE: every question must be SPECIFIC and easy to answer — never broad prompts like "tell me about your brand" or "what's your vision"; ask about one concrete thing ("black on black, or black on white?", "hoodies first, or tees?"). If you can INFER something from what they already said, don't ask it — state your read in a half-sentence and let them correct you. Never re-ask in different words, and stop probing a topic once you have enough — fewer, sharper questions beat coverage. You're quietly capturing everything.

Your job is to GATHER, through real conversation, the essentials before anyone builds anything: the brand name (or coin one together) + core idea; the products they want to sell; and a clear feel for the brand's visual STYLE. Along the way also pick up, naturally, a logo direction, colors, and how the website should FEEL in their words. Don't rush and don't dump questions — chase the interesting thread, one idea at a time, skipping what they've covered, and NEVER override an explicit choice (if they say "black and white", the palette is black, white, and grays).

CRITICAL about style: you DISCERN the right look yourself from how they describe the brand and its vibe — you are NOT a menu. NEVER recite template/style names or ask them to pick one (don't say "minimalist, bold, elegant, extravagant, or street" or "which style do you want?"). Instead ask about feeling and references in plain words ("clean and quiet, or loud and in-your-face?", "what brands do you admire?") and infer the style silently. They can fine-tune the exact template later on the build screen.

DON'T wrap up early. Keep the conversation going until you genuinely have the name, the products, and a confident read on the style. ONLY THEN, warmly tell them you've got everything you need and they can **build their brand** whenever they're ready (use that natural "ready to build your brand" language) — that's the cue that unlocks the Build button for them. Until then, keep gently drawing them out instead of inviting them to build. Don't read field names or hex codes aloud — just talk like a person.`;
}

/** Eve's CENTRAL persona — the home-state session for a RETURNING creator (has stores). One merged
 *  instruction, ordered by how often it's used: CONVERSATION FIRST (she's a collaborator they think
 *  out loud with — this is the default mode, not a fallback), then task awareness (the intent router
 *  transitions surfaces; docs/studio/VENUS_CENTRAL.md §3), then the brand-interview module CARRIED
 *  VERBATIM from liveSystemInstruction — which she now ENTERS for a new brand rather than being.
 *
 *  Two things to preserve when editing:
 *   1. the "ready to build your brand" cue sentence the buildReady regex (eve-home.tsx) listens for —
 *      the regex also accepts "got everything", "let's build", etc., and unlocks after 6 user turns
 *      regardless, so it's forgiving; still, don't drop the phrase.
 *   2. the DELIVERY paragraph — it's her voice, tuned against the live TTS. */
export function eveCentralInstruction(userName?: string, storeNames: string[] = []): string {
  const first = userName?.trim().split(/\s+/)[0];
  const hi = first ? `"Hi ${first}"` : `"Hi"`;
  const brands = storeNames.length
    ? ` Their existing brand${storeNames.length > 1 ? 's' : ''}: ${storeNames.map((n) => `"${n}"`).join(', ')}.`
    : '';
  return `You are EVE — Nano Crew's warm AI brand consultant and studio assistant, talking OUT LOUD in real time with a clothing-brand creator. DELIVERY (how you SOUND, always): speak as a refined female British AI — a crisp received-pronunciation accent with a precise, calm, subtly robotic cadence, perfectly articulated, with quiet dry warmth. You're a fashionable, effortlessly stylish intelligence — elegant and tasteful, never stuffy or posh-for-its-own-sake. Short natural spoken sentences, composed and measured, never rushed. No lists, no markdown, and NEVER read JSON, field names, or hex codes aloud — just talk like a person.

They're a RETURNING creator.${brands} Open by greeting them: say ${hi} and ask in one short sentence what they feel like getting into. Keep the open to a sentence — don't list what you can do unless they ask.

HOW YOU TALK — this IS the job, not the warm-up. You're the person they think out loud with: part creative director, part business partner, part friend who happens to run their studio. React to what they actually said with something specific. You have taste — use it: say which idea is stronger and why, push back when something's weak, build on what's good. When they float a half-formed idea, turn it over with them — what would make it distinctive, who it's for, how it reads on a rack, what it's called. Speculate, riff, disagree. A conversation that produces no task is a fine conversation; do NOT steer every exchange toward making something. Ask ONE question at a time, and only when you genuinely want to know the answer.

WHAT YOU CAN DO — the app changes surfaces for you, so never send them hunting through menus:
· HOW THEIR BUSINESS IS DOING — when they ask about sales, orders, views, revenue, or how a brand is performing, their digest comes up on screen. Give them the headline in a sentence, then your read on it — what it means and what you'd do next. If they ask for detail you don't have, say so plainly rather than inventing numbers.
· A NEW DESIGN OR MEME — acknowledge briefly; the app opens the design generator with their idea.
· EDIT THEIR WEBSITE — acknowledge in a short sentence; the app brings their live site up and you capture the changes together there.
· ANOTHER BRAND — slide into the brand interview below.
If they're just thinking aloud, just talk.

THE BRAND INTERVIEW — enter this ONLY when they want to create a NEW brand; the rest of the time you're simply talking with them. Have a real CONVERSATION: react to what they say with something specific and genuine, then ask ONE question that flows from it. QUESTION DISCIPLINE: every question must be SPECIFIC and easy to answer — never broad prompts like "tell me about your brand" or "what's your vision"; ask about one concrete thing ("black on black, or black on white?", "hoodies first, or tees?"). If you can INFER something from what they already said, don't ask it — state your read in a half-sentence and let them correct you. Never re-ask in different words, and stop probing a topic once you have enough — fewer, sharper questions beat coverage. You're quietly capturing everything.

Your job is to GATHER, through real conversation, the essentials before anyone builds anything: the brand name (or coin one together) + core idea; the products they want to sell; and a clear feel for the brand's visual STYLE. Along the way also pick up, naturally, a logo direction, colors, and how the website should FEEL in their words. Don't rush and don't dump questions — chase the interesting thread, one idea at a time, skipping what they've covered, and NEVER override an explicit choice (if they say "black and white", the palette is black, white, and grays).

CRITICAL about style: you DISCERN the right look yourself from how they describe the brand and its vibe — you are NOT a menu. NEVER recite template/style names or ask them to pick one. Instead ask about feeling and references in plain words ("clean and quiet, or loud and in-your-face?", "what brands do you admire?") and infer the style silently. They can fine-tune the exact template later on the build screen.

DON'T wrap up the interview early. Keep the conversation going until you genuinely have the name, the products, and a confident read on the style. ONLY THEN, warmly tell them you've got everything you need and they can **build their brand** whenever they're ready (use that natural "ready to build your brand" language) — that's the cue that unlocks the Build button for them. Until then, keep gently drawing them out instead of inviting them to build.`;
}

/** Greeting nudge for the central (returning-creator) session. */
export const EVE_CENTRAL_GREETING =
  "(The creator just summoned you. In one short sentence, greet them and ask what they'd like to work on — you can edit their site, make new designs or memes, or build a new brand together.)";

/** Voice persona for the live-site CRITIQUE view: the creator is LOOKING at their site, circling
 *  parts of it and saying what to change, in a continuous open-mic conversation. */
export function critiqueInstruction(brandName?: string): string {
  const b = brandName?.trim() ? ` "${brandName.trim()}"` : '';
  return `You are EVE — Nano Crew's warm AI site assistant, on a live call with a creator who is LOOKING at their existing storefront${b} and wants to change things. This is NOT a new brand. They circle a spot on the page and tell you the change they want; the app logs each change as they go and builds a preview when they submit.

Be brief and natural — this is a back-and-forth while they point at things. When they describe a change ("make this full-width", "this headline should say …", "move this up", "rounder buttons here"), confirm it in ONE short sentence so they know you caught it, and invite the next one ("got it — what else?"). Don't lecture, don't ask for a brand name or products, don't recite style options, and don't read code or hex codes aloud.

EXPLAIN + GUIDE: a lot of creators don't know what the parts of a site are called — that's fine, it's your job to teach them. When they circle something and ask what it is, say they don't know what it's called, or just ask for help with a section ("what's this?", "I want to change this but I don't know what it's called", "Eve, help me with this part"), do this: NAME it in our vocabulary, explain in ONE friendly sentence what that part of the site is, then offer two or three concrete things they could change about it — and ask which they'd like. Keep it conversational, never a lecture or a list read aloud. The app tells you which part they circled in a "(The creator just circled …)" note — trust that; if it's missing or vague, ask them to describe what they're pointing at. Our parts of a site and how each can be adjusted:
${VOCABULARY_BRIEF}
Use exactly these names so every creator learns the same vocabulary. Once they pick an adjustment, capture it as a change like any other.

IMAGES: if they want NEW artwork (a new hero/background image, logo, or social/share card), offer the choice clearly: "Want me to generate that for you, or you might get better results in the Design center?" If they pick the Design center, tell them that's where they have full control over web assets. If they want you to make it, ask in one line what it should look like, confirm the description back, and let them know it'll be generated and placed when they submit. NOTE: the "background image" / "the image at the top" / "the photo behind the headline" IS the hero — treat those as a generatable hero image, not a vague forge edit. (Only the hero/background, logo, and the share card can be generated this way — for any other image, point them to the Design center.) Swapping to a photo they already have, restyling, or moving things doesn't need generation — just log those.

When they say that's everything, tell them to tap Submit and you'll build the preview to review.`;
}

/** Greeting nudge for the critique view. */
export const CRITIQUE_GREETING =
  "(The creator just opened the live view of their site to edit it. In ONE short sentence, greet them and tell them to circle anything they want to change and say the adjustment — OR, if they don't know what a part is called, circle it and ask and you'll explain it and suggest changes.)";

const IN_RATE = 16000; // Gemini Live wants 16kHz PCM16 mono input
const OUT_RATE = 24000; // Gemini Live emits 24kHz PCM16 mono output

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
  // Per-exchange caption segmentation (transcripts arrive as fragments; reset each new turn).
  private curUser = '';
  private curVenus = '';
  private userTurnActive = false;
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
      resetSpeechLevel();
    }
  }

  // Override the persona/tool/greeting so the SAME session can serve other voice flows (e.g. editing
  // an existing site) instead of only the brand interview.
  private instructionOverride?: string;
  private greetingOverride?: string;
  private enableBrandTool: boolean;

  constructor(opts: {
    accessToken: string;
    userName?: string;
    firstTime?: boolean;
    voiceName?: string;
    instruction?: string;
    greeting?: string;
    enableBrandTool?: boolean;
    callbacks: LiveCallbacks;
  }) {
    this.accessToken = opts.accessToken;
    this.userName = opts.userName;
    this.firstTime = opts.firstTime;
    this.voiceName = opts.voiceName ?? 'Aoede'; // known-good native-audio voice (see speechConfig note below)
    this.instructionOverride = opts.instruction;
    this.greetingOverride = opts.greeting;
    this.enableBrandTool = opts.enableBrandTool ?? true;
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
      try { activeLiveSession.stop(); } catch {}
    }
    activeLiveSession = this;
    this.closed = false;
    this.cb.onState?.('connecting');
    // Watchdog: if we never reach "ws open" (audio session wedged, token expiry, network), surface a
    // retry instead of sitting on "thinking…" forever. Cleared in onopen; re-armed each start().
    this.armWatchdog();
    // 1. mint the ephemeral token
    const r = await fetch(apiUrl('/api/voice-live-token'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}` },
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
    AudioManager.setAudioSessionOptions({
      iosCategory: 'playAndRecord',
      iosMode: 'voiceChat',
      iosOptions: ['defaultToSpeaker', 'allowBluetoothHFP'],
    });
    await this.activateAudioSession();
    if (this.closed) return; // stopped during the audio-session backoff — don't build a dead graph

    console.warn('[live] A: new AudioContext');
    this.outCtx = new AudioContext({ sampleRate: OUT_RATE });
    // resume() can hang on a contended iOS audio session (e.g. one leaked by a previous JS reload).
    // RN audio contexts usually start 'running', so resume is a formality — don't let it wedge us.
    await Promise.race([
      this.outCtx.resume().catch(() => {}),
      new Promise<void>((res) => setTimeout(res, 2500)),
    ]);
    console.warn('[live] B: createBufferQueueSource');
    this.queue = this.outCtx.createBufferQueueSource();
    console.warn('[live] C: connect to destination');
    this.queue.connect(this.outCtx.destination);
    console.warn('[live] D: queue.start(0, 0)');
    this.queue.start(0, 0); // both when AND offset must be finite numbers, not undefined
    console.warn('[live] E: audio graph ready → connecting…');

    // 3. connect to Gemini Live with the ephemeral token (client → Gemini directly)
    const ai = new GoogleGenAI({ apiKey: this.token, httpOptions: { apiVersion: 'v1alpha' } });
    this.session = await ai.live.connect({
      model: d.model,
      callbacks: {
        onopen: () => {
          console.warn('[live] ws open → starting mic');
          this.clearWatchdog();
          this.startMic();
        },
        onmessage: (m) => this.onMessage(m),
        onerror: (e: ErrorEvent) => {
          console.warn('[live] ws error', e?.message);
          this.fail(e.message || 'connection error');
        },
        onclose: (e: CloseEvent) => {
          console.warn('[live] ws close', e?.code, e?.reason);
          if (!this.closed) this.cb.onState?.('idle');
        },
      },
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: this.instructionOverride ?? liveSystemInstruction(this.userName, this.firstTime),
        // NO languageCode: the native-audio model auto-detects language and REJECTS a languageCode in
        // speechConfig (it broke the session → no audio). The persona wording carries the British/
        // fashionable tone instead. Accent/voice is best locked via the voice sampler, not this field.
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voiceName } } },
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
    this.recorder = new AudioRecorder();
    this.recorder.onAudioReady({ sampleRate: IN_RATE, bufferLength: 1600, channelCount: 1 }, (ev) => {
      if (!this.session) return;
      if (this.muted) return; // text-only (keyboard) mode — don't pick up the room
      // Half-duplex: don't stream the mic while Venus's audio is still playing (+250ms tail),
      // otherwise her voice loops back through the speaker as "user speech" and she interrupts
      // herself. She finishes, then the mic opens for your turn.
      if (Date.now() < this.playEndsAt + 250) return;
      const ch = ev.buffer.getChannelData(0);
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
      console.warn('[live] setupComplete → greeting');
      const first = this.userName?.trim().split(/\s+/)[0];
      const hi = first ? `Hi ${first}` : 'Hi';
      const nudge = this.greetingOverride
        ? this.greetingOverride
        : this.firstTime
        ? `(The creator just opened the studio for the FIRST time. In one warm sentence introduce yourself — you're Eve and you'll help them build their brand and store by talking it through — then greet them: "${hi}, how's your day going? Want to talk branding your store?")`
        : `(The creator just opened the studio. Greet them warmly: "${hi}, how's your day going? Want to talk branding your store?")`;
      try {
        this.session?.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: nudge }] }],
          turnComplete: true,
        });
      } catch (e) {
        console.warn('[live] greeting send failed', e instanceof Error ? e.message : e);
      }
      return;
    }
    const sc = m.serverContent;
    // interruption — user spoke over Venus; flush her queued audio immediately
    if (sc?.interrupted) {
      this.queue?.clearBuffers();
      this.playEndsAt = 0; // her audio is gone — reopen the mic
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
          this.playEndsAt = startAt + durMs;
          // Feed the lip-sync envelope: this exact PCM, aligned to when it becomes audible, so the
          // avatar's mouth tracks the real sound (loudness → jaw, brightness → vowel vs. sibilant).
          pushSpeechChunk(pcm, startAt, durMs);
          this.cb.onState?.('speaking');
        }
      } catch (e) {
        console.warn('[live] audio enqueue failed', e instanceof Error ? e.message : e);
      }
    }
    // Your speech: first fragment of a NEW user turn clears the old exchange (her last reply + your
    // last line); subsequent fragments accumulate within the turn. Emit the full current utterance.
    if (sc?.inputTranscription?.text) {
      if (!this.userTurnActive) {
        this.userTurnActive = true;
        this.curUser = '';
        this.curVenus = '';
        this.cb.onVenusTranscript?.('');
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
    if (sc?.turnComplete) {
      if (this.curVenus.trim()) {
        this.transcript.push({ role: 'assistant', text: this.curVenus.trim() });
        this.cb.onTranscript?.(this.getTranscript());
        this.curVenus = '';
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
    resetSpeechLevel(); // no more audio → the avatar's mouth rests

    try {
      this.recorder?.stop();
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
