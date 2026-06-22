import { GoogleGenAI, Modality } from '@google/genai';

import { getUserFromRequest } from '@/lib/auth';
import { guardRate } from '@/lib/rate-limit';

// POST /api/say — one-shot TTS in VENUS'S OWN GEMINI VOICE (Aoede), the same voice as the live
// brand interview (lib/live-voice.ts). Used for short spoken announcements OUTSIDE a live session —
// e.g. the "your store is online" launch line after a brand is built — so the voice never switches
// to the legacy ElevenLabs `/api/voice` `say` path mid-flow.
//
// Gemini TTS returns raw PCM16 (24kHz mono); we WAV-wrap it server-side so the client can play it
// straight from a .wav file. Body: { text }. Returns: { audio: base64 WAV }.

const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const VENUS_VOICE = 'Aoede'; // MUST match LiveVoiceSession's default voiceName
const RATE = 24000; // Gemini TTS PCM sample rate (Hz), mono, 16-bit

/** Wrap raw PCM16 mono into a minimal 44-byte WAV container so any audio player can decode it. */
function pcmToWav(pcm: Buffer, sampleRate = RATE): Buffer {
  const header = Buffer.alloc(44);
  const dataLen = pcm.length;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate = rate * channels * bytesPerSample
  header.writeUInt16LE(2, 32); // block align = channels * bytesPerSample
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);
  return Buffer.concat([header, pcm]);
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const limited = await guardRate(`say:${user.id}`, 30, 60);
  if (limited) return limited;

  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: 'GOOGLE_GENAI_API_KEY not configured' }, { status: 500 });

  let text: string;
  try {
    const body = (await req.json()) as { text?: string };
    text = typeof body.text === 'string' ? body.text.trim().slice(0, 300) : '';
    if (!text) throw new Error();
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
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VENUS_VOICE } } },
      },
    });
    const data = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
    if (!data) return Response.json({ error: 'no audio returned' }, { status: 502 });
    const wav = pcmToWav(Buffer.from(data, 'base64'));
    return Response.json({ audio: wav.toString('base64') });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'tts failed' }, { status: 502 });
  }
}
