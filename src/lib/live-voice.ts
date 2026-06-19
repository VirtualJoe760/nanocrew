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
import { AudioContext, AudioRecorder, AudioBufferQueueSourceNode } from 'react-native-audio-api';

import { apiUrl } from '@/lib/api';
import { interviewSystem, type BrandResult } from '@/lib/interview';

const IN_RATE = 16000; // Gemini Live wants 16kHz PCM16 mono input
const OUT_RATE = 24000; // Gemini Live emits 24kHz PCM16 mono output

export type LiveState = 'connecting' | 'listening' | 'speaking' | 'thinking' | 'idle' | 'error';

export interface LiveCallbacks {
  onState?: (s: LiveState) => void;
  onUserTranscript?: (text: string) => void; // running input transcription
  onVenusTranscript?: (text: string) => void; // running output transcription
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
    required: ['name', 'tagline', 'designStyle', 'products', 'palette'],
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
  private cb: LiveCallbacks;
  private token: string;
  private accessToken: string;
  private userName?: string;
  private voiceName: string;
  private closed = false;

  constructor(opts: { accessToken: string; userName?: string; voiceName?: string; callbacks: LiveCallbacks }) {
    this.accessToken = opts.accessToken;
    this.userName = opts.userName;
    this.voiceName = opts.voiceName ?? 'Aoede'; // warm Gemini voice
    this.cb = opts.callbacks;
    this.token = '';
  }

  async start() {
    this.cb.onState?.('connecting');
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
    this.outCtx = new AudioContext({ sampleRate: OUT_RATE });
    this.queue = this.outCtx.createBufferQueueSource();
    this.queue.connect(this.outCtx.destination);
    this.queue.start();

    // 3. connect to Gemini Live with the ephemeral token (client → Gemini directly)
    const ai = new GoogleGenAI({ apiKey: this.token, httpOptions: { apiVersion: 'v1alpha' } });
    this.session = await ai.live.connect({
      model: d.model,
      callbacks: {
        onopen: () => {
          console.warn('[live] ws open → starting mic');
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
        systemInstruction: interviewSystem(this.userName, 'Venus'),
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
    const sc = m.serverContent;
    // interruption — user spoke over Venus; flush her queued audio immediately
    if (sc?.interrupted) {
      this.queue?.clearBuffers();
      this.cb.onState?.('listening');
    }
    // streamed audio out → enqueue for gapless playback
    const audio = m.data;
    if (audio && this.outCtx && this.queue) {
      const pcm = base64ToInt16(audio);
      const buf = this.outCtx.createBuffer(1, pcm.length, OUT_RATE);
      const f = buf.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) f[i] = pcm[i] / 32768;
      this.queue.enqueueBuffer(buf);
      this.cb.onState?.('speaking');
    }
    if (sc?.inputTranscription?.text) this.cb.onUserTranscript?.(sc.inputTranscription.text);
    if (sc?.outputTranscription?.text) this.cb.onVenusTranscript?.(sc.outputTranscription.text);
    if (sc?.turnComplete) this.cb.onState?.('listening');

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

  private fail(msg: string) {
    this.cb.onError?.(msg);
    this.cb.onState?.('error');
  }

  async stop() {
    this.closed = true;
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
    this.recorder = null;
    this.queue = null;
    this.outCtx = null;
    this.session = null;
    this.cb.onState?.('idle');
  }
}
