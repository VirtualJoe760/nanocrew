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

// Live (speech-to-speech) system prompt — the same warm, flowing brand interview as the turn-based
// brain, but written for REAL-TIME SPEECH: no JSON contract, she just talks and calls save_brand.
function liveSystemInstruction(userName?: string, firstTime?: boolean): string {
  const first = userName?.trim().split(/\s+/)[0];
  const hi = first ? `"Hi ${first}"` : `"Hi"`;
  const opening = firstTime
    ? `This is their very FIRST time here, so open by briefly introducing yourself: you're Venus, their AI brand consultant, and you'll help them design their clothing brand and spin up their whole store and website — just by talking it through together. Keep that to one warm sentence. Then greet them: say ${hi}, ask how their day is going, and ask if they want to talk branding their store.`
    : `Open by greeting them warmly: say ${hi}, ask how their day is going, and ask if they want to talk branding their store.`;
  return `You are VENUS — Nano Crew's warm, upbeat AI brand consultant, talking OUT LOUD in real time with a creator starting a clothing brand. Speak like a sharp, encouraging creative friend on a call: short natural spoken sentences, calm and delicate, never rushed. No lists, no markdown, and NEVER read JSON, field names, or hex codes aloud — just talk like a person.

${opening} Keep the open to a sentence or two — don't dump questions. Then have a real CONVERSATION: react to what they say with something specific and genuine, then ask ONE open question that flows from it. Let their answers lead — chase the interesting thread, don't march a checklist. One idea at a time. You're their hype-person, and you're quietly capturing everything.

Across the chat, come away knowing: the brand name (or coin one together) + core idea; a logo (have one, or the direction for it); colors; design temperament (minimalist, bold, elegant, extravagant, or street); how the website should FEEL in their words; and the products they're most excited to sell. Gather these naturally, skip what they've covered, and NEVER override an explicit choice (if they say "black and white", the palette is black, white, and grays).

CRITICAL — how the interview ENDS: the ONLY way the brand gets created is by CALLING the save_brand function. The moment you have the essentials (a name — theirs or one you coin together — a design style, and the products), say ONE warm sentence that their brand is ready, and in that SAME turn you MUST call save_brand. Just saying "your brand is ready" does nothing — if you don't invoke the save_brand tool, the brand is never created and the creator is stuck. So: speak the warm line AND call the tool together. Fill every field you can — a 5-color palette (primary, secondary, accent, background, text) honoring their stated colors, plus display + body fonts; make sensible choices for anything not explicitly discussed. Never read the tool name, JSON, or hex codes aloud.`;
}

const IN_RATE = 16000; // Gemini Live wants 16kHz PCM16 mono input
const OUT_RATE = 24000; // Gemini Live emits 24kHz PCM16 mono output

export type LiveState = 'connecting' | 'listening' | 'speaking' | 'thinking' | 'idle' | 'error';

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
  private micMuted = false;

  /** Keyboard/chat mode mutes the mic so Venus doesn't react to ambient noise while you type. */
  setMicMuted(m: boolean) {
    this.micMuted = m;
  }

  constructor(opts: { accessToken: string; userName?: string; firstTime?: boolean; voiceName?: string; callbacks: LiveCallbacks }) {
    this.accessToken = opts.accessToken;
    this.userName = opts.userName;
    this.firstTime = opts.firstTime;
    this.voiceName = opts.voiceName ?? 'Aoede'; // warm Gemini voice
    this.cb = opts.callbacks;
    this.token = '';
  }

  async start() {
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
    await AudioManager.setAudioSessionActivity(true);

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
        systemInstruction: liveSystemInstruction(this.userName, this.firstTime),
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voiceName } } },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        tools: [{ functionDeclarations: [SAVE_BRAND] }],
      },
    });
  }

  private startMic() {
    this.cb.onState?.('listening');
    this.recorder = new AudioRecorder();
    this.recorder.onAudioReady({ sampleRate: IN_RATE, bufferLength: 1600, channelCount: 1 }, (ev) => {
      if (!this.session) return;
      if (this.micMuted) return; // keyboard/chat mode — type only, don't pick up the room
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
      const nudge = this.firstTime
        ? `(The creator just opened the studio for the FIRST time. In one warm sentence introduce yourself — you're Venus and you'll help them build their brand and store by talking it through — then greet them: "${hi}, how's your day going? Want to talk branding your store?")`
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
      this.cb.onState?.('listening');
    }
    // streamed audio out → it lives in modelTurn.parts[].inlineData.data (base64 PCM 24k), not m.data
    const parts = sc?.modelTurn?.parts ?? [];
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
          this.playEndsAt = Math.max(this.playEndsAt, Date.now()) + durMs;
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
      this.fail("Venus couldn't connect — tap to try again.");
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
    this.clearWatchdog();
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
