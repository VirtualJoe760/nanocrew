import { GoogleGenAI, Modality } from '@google/genai';

import { getUserFromRequest } from '@/lib/auth';
import { guardRate } from '@/lib/rate-limit';

// POST /api/simli/tts — Venus's line in her Gemini voice (Aoede), as Simli-ready audio.
// Mirrors /api/say but FOR THE SIMLI photoreal avatar: Gemini TTS returns PCM16 mono @24kHz, while
// simli-client's sendAudioData expects raw PCM16 mono @16kHz (its AudioContext is pinned to 16000),
// so we resample 24k→16k server-side and return the RAW bytes (NOT WAV-wrapped). The frame
// (simli-venus-html.ts) base64-decodes these straight into client.sendAudioData(). Tester-gated +
// rate-limited like the session route, since each Simli/Gemini call costs. Body: { text }.
// Returns: { pcm: base64 PCM16 16kHz mono, sampleRate }. See docs/studio/VENUS_AVATAR.md "Simli".

const VENUS_LAB_EMAIL = 'josephsardella@gmail.com';
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const VENUS_VOICE = 'Aoede'; // the DEFAULT — MUST match LiveVoiceSession + /api/say
// Voice AUDITION (Lab): the request may name any of these Gemini prebuilt voices to hear a
// candidate. Making one THE voice = change VENUS_VOICE here + /api/say + studio.tsx LIVE_VOICE.
const VOICE_OPTIONS = ['Aoede', 'Leda', 'Kore', 'Zephyr', 'Callirrhoe', 'Despina', 'Erinome', 'Laomedeia'];
const GEMINI_RATE = 24000; // Gemini TTS PCM sample rate
const SIMLI_RATE = 16000; // simli-client AudioContext sampleRate

/** Downsample PCM16 mono from `inRate` to `outRate` by linear interpolation (good enough for voice).
 *  Endian-explicit reads/writes so it's safe regardless of Buffer alignment. */
function resamplePcm16(pcm: Buffer, inRate: number, outRate: number): Buffer {
  if (inRate === outRate) return pcm;
  const n = Math.floor(pcm.byteLength / 2);
  const inS = new Int16Array(n);
  for (let i = 0; i < n; i++) inS[i] = pcm.readInt16LE(i * 2);
  const ratio = inRate / outRate;
  const outLen = Math.floor(n / ratio);
  const out = Buffer.alloc(outLen * 2);
  for (let j = 0; j < outLen; j++) {
    const pos = j * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = inS[i0] ?? 0;
    const b = inS[i0 + 1] ?? a;
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(a + (b - a) * frac))), j * 2);
  }
  return out;
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if ((user.email ?? '').trim().toLowerCase() !== VENUS_LAB_EMAIL) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }
  const limited = await guardRate(`simli-tts:${user.id}`, 30, 60);
  if (limited) return limited;

  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: 'GOOGLE_GENAI_API_KEY not configured' }, { status: 500 });

  let text: string;
  let voice = VENUS_VOICE;
  try {
    const body = (await req.json()) as { text?: string; voice?: string };
    text = typeof body.text === 'string' ? body.text.trim().slice(0, 300) : '';
    if (!text) throw new Error();
    if (typeof body.voice === 'string' && VOICE_OPTIONS.includes(body.voice)) voice = body.voice;
  } catch {
    return Response.json({ error: 'text is required' }, { status: 400 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: TTS_MODEL,
      contents: [{ role: 'user', parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    });
    const data = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
    if (!data) return Response.json({ error: 'no audio returned' }, { status: 502 });
    const pcm16k = resamplePcm16(Buffer.from(data, 'base64'), GEMINI_RATE, SIMLI_RATE);
    return Response.json({ pcm: pcm16k.toString('base64'), sampleRate: SIMLI_RATE });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'tts failed' }, { status: 502 });
  }
}
