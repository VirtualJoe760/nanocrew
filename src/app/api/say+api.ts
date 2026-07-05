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
const VENUS_VOICE = 'Kore'; // Joe's pick — MUST match studio LIVE_VOICE ('Kore', british-robot delivery)
// Her ASSIGNED delivery (matches the live session's DELIVERY instruction). Auto-applied to
// production calls; requests that specify a `voice` (the Lab audition) compose their own
// direction client-side and are passed through untouched.
const VENUS_TONE =
  'Speak as a refined female British AI — a crisp received-pronunciation accent with a precise, calm, subtly robotic cadence, perfectly articulated: ';
const RATE = 24000; // Gemini TTS PCM sample rate (Hz), mono, 16-bit
// Voice AUDITION (the Lab's orb-mode picker): the request may name any Gemini prebuilt voice.
// This is the FULL catalog (gemini-2.5 TTS + native-audio Live). NB Sulafat broke the LIVE
// session once (studio.tsx) — auditioning it here via TTS is fine, just don't make it LIVE_VOICE
// without re-testing. Making a choice permanent = VENUS_VOICE here + LIVE_VOICE in studio.tsx.
const VOICE_OPTIONS = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
  'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi',
  'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird',
  'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
];

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
  let voice = VENUS_VOICE;
  let explicitVoice = false;
  try {
    const body = (await req.json()) as { text?: string; voice?: string };
    text = typeof body.text === 'string' ? body.text.trim().slice(0, 500) : ''; // 500: leaves room for a tone-direction prefix
    if (!text) throw new Error();
    if (typeof body.voice === 'string' && VOICE_OPTIONS.includes(body.voice)) {
      voice = body.voice;
      explicitVoice = true; // the Lab audition — it composes its own tone direction
    }
  } catch {
    return Response.json({ error: 'text is required' }, { status: 400 });
  }
  // production calls speak IN CHARACTER: her assigned british-robot delivery wraps the line
  if (!explicitVoice) text = `${VENUS_TONE}"${text}"`;

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
    const wav = pcmToWav(Buffer.from(data, 'base64'));
    return Response.json({ audio: wav.toString('base64') });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'tts failed' }, { status: 502 });
  }
}
