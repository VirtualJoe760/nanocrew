import { GoogleGenAI } from '@google/genai';

import { getUserFromRequest } from '@/lib/auth';
import { uploadRaw } from '@/lib/cloudinary';
import { interviewSystem, parseTurn, type ChatMessage, type TimedWord } from '@/lib/interview';
import { guardRate } from '@/lib/rate-limit';
import { resolveVoice } from '@/lib/voices';

// POST /api/voice — one spoken turn of the Studio brand interview.
// Body: { messages: ChatMessage[], audio?: base64 m4a, init?: true }
//   init: true  → no audio; generate the opening line.
// Returns: { userText?, done, question?, brand?, speech: base64 mp3 }
const MODEL = 'gemini-2.5-flash';
// On a persistent 2.5-flash overload wave, fall back to 2.0-flash so Venus keeps talking.
const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];

// Gemini occasionally returns 503 UNAVAILABLE / "overloaded" / 429 — transient, server-side.
const TRANSIENT = /unavailable|overloaded|try again|503|429|rate.?limit|deadline|temporar/i;

/**
 * generateContent with backoff retries on transient (overload/unavailable) errors, then a model
 * fallback: each model gets `attempts` tries; if it's still overloaded we move to the next model.
 * A non-transient error (bad request, etc.) throws immediately.
 */
async function generateWithRetry(
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI['models']['generateContent']>[0],
  attempts = 2,
) {
  let lastErr: unknown;
  for (const model of MODELS) {
    for (let i = 0; i < attempts; i++) {
      try {
        return await ai.models.generateContent({ ...params, model });
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        if (!TRANSIENT.test(msg)) throw e; // not an overload — real error, surface it
        await new Promise((r) => setTimeout(r, 600 * (i + 1))); // 600ms, 1200ms
      }
    }
    // this model stayed overloaded across all attempts → try the next model
  }
  throw lastErr;
}


const TEMPO = 0.87; // the atempo factor; playback is slowed to this fraction of real-time

/**
 * Subtle sci-fi room reverb + gentle tempo pull-down via ffmpeg, when the host has it.
 * Returns the audio AND the tempo factor ACTUALLY applied — 1.0 when ffmpeg is missing/failed
 * (dry take), so word timings scale to reality and never drift out of sync.
 */
async function addReverb(mp3: Buffer): Promise<{ buffer: Buffer; tempo: number }> {
  try {
    const { execFileSync } = await import('node:child_process');
    const { writeFileSync, readFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const base = `${tmpdir()}/entity-${process.pid}-${Math.random().toString(36).slice(2)}`;
    writeFileSync(`${base}.mp3`, mp3);
    execFileSync(
      'ffmpeg',
      ['-y', '-i', `${base}.mp3`, '-af', `atempo=${TEMPO},aecho=0.8:0.55:38|57:0.16|0.10`, '-b:a', '64k', `${base}-wet.mp3`],
      { stdio: 'ignore', timeout: 10000 },
    );
    const wet = readFileSync(`${base}-wet.mp3`);
    rmSync(`${base}.mp3`, { force: true });
    rmSync(`${base}-wet.mp3`, { force: true });
    return { buffer: wet, tempo: TEMPO };
  } catch {
    return { buffer: mp3, tempo: 1 }; // no ffmpeg (or it failed) — dry take at real tempo
  }
}

/** Map ElevenLabs character alignment → per-word start times, scaled by the tempo actually applied. */
function toWordTimings(chars: string[], starts: number[], tempo: number): TimedWord[] {
  const words: TimedWord[] = [];
  let current = '';
  let start = 0;
  chars.forEach((c, i) => {
    if (/\s/.test(c)) {
      if (current) words.push({ w: current, t: start / tempo });
      current = '';
    } else {
      if (!current) start = starts[i] ?? 0;
      current += c;
    }
  });
  if (current) words.push({ w: current, t: start / tempo });
  return words;
}

async function speak(text: string, voiceId: string): Promise<{ speech: string; words: TimedWord[] }> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY not configured');
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_64`,
    {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.62, similarity_boost: 0.75 },
      }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    audio_base64: string;
    alignment?: { characters: string[]; character_start_times_seconds: number[] };
  };
  const dry = Buffer.from(data.audio_base64, 'base64');
  const { buffer, tempo } = await addReverb(dry);
  const speech = buffer.toString('base64');
  const words = data.alignment
    ? toWordTimings(data.alignment.characters, data.alignment.character_start_times_seconds, tempo)
    : [];
  return { speech, words };
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const limited = await guardRate(`voice:${user.id}`, 40, 60);
  if (limited) return limited;

  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: 'GOOGLE_GENAI_API_KEY not configured' }, { status: 500 });

  let messages: ChatMessage[];
  let audio: string | undefined;
  let text: string | undefined;
  let init = false;
  let say: string | undefined;
  let voiceId: string | undefined;
  try {
    const body = (await req.json()) as {
      messages?: ChatMessage[];
      audio?: string;
      text?: string;
      init?: boolean;
      say?: string;
      voiceId?: string;
    };
    messages = (body.messages ?? []).slice(-30);
    audio = body.audio;
    text = typeof body.text === 'string' ? body.text.trim().slice(0, 1200) : undefined;
    init = !!body.init;
    say = typeof body.say === 'string' ? body.say.slice(0, 300) : undefined;
    voiceId = typeof body.voiceId === 'string' ? body.voiceId : undefined;
    if (!init && !audio && !say && !text) throw new Error();
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }

  // Allowlisted roster only — unknown ids fall back to the default consultant.
  const voice = resolveVoice(voiceId);

  // say mode: pure TTS — the app provides the line (e.g. a voice preview, or announcing
  // the store launch). These are STATIC (same text+voice → same audio), so cache the
  // rendered clip through Cloudinary at a deterministic id. Cloudinary is external, so it
  // survives expo serve's per-request isolation (in-process caches don't) — repeats never
  // re-hit ElevenLabs.
  if (say) {
    const cloud = process.env.CLOUDINARY_CLOUD_NAME;
    let publicId: string | null = null;
    if (cloud) {
      const { createHash } = await import('node:crypto');
      publicId = `nanocrew/tts/${createHash('sha1').update(`${voice.id}:${say}`).digest('hex')}`;
      try {
        const cdn = await fetch(`https://res.cloudinary.com/${cloud}/raw/upload/${publicId}`);
        if (cdn.ok) {
          const c = (await cdn.json()) as { speech: string; words: TimedWord[] };
          return Response.json({ line: say, speech: c.speech, words: c.words, cached: true });
        }
      } catch {
        /* cache miss / fetch error → render below */
      }
    }
    try {
      const tts = await speak(say, voice.id);
      if (publicId) {
        await uploadRaw(Buffer.from(JSON.stringify(tts)), publicId).catch(() => {});
      }
      return Response.json({ line: say, speech: tts.speech, words: tts.words });
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 502 });
    }
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const history = messages.map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('model' as const),
      parts: [{ text: m.text }],
    }));
    const lastParts = init
      ? [{ text: 'Start the interview with your first spoken question.' }]
      : text
        ? [
            {
              text: `I typed this answer (no audio): "${text}". Continue per the contract, setting userText to exactly what I typed.`,
            },
          ]
        : [
            { inlineData: { mimeType: 'audio/mp4', data: audio! } },
            { text: 'This audio is my answer. Continue per the contract.' },
          ];

    const res = await generateWithRetry(ai, {
      model: MODEL,
      contents: [...history, { role: 'user', parts: lastParts }],
      config: {
        systemInstruction: interviewSystem(user.name, voice.name),
        temperature: 0.9,
        responseMimeType: 'application/json',
      },
    });
    const raw = res.text?.trim();
    if (!raw) throw new Error('empty model response');
    const turn = parseTurn(raw);

    // Hallucination guard: if the audio carried no real words, do NOT let the model riff
    // on its own prompt examples — hand the floor back gently.
    if (!init && (turn.userText?.trim().length ?? 0) < 2) {
      const line = "I didn't catch that — tap me when you're ready.";
      const tts = await speak(line, voice.id);
      return Response.json({ empty: true, line, speech: tts.speech, words: tts.words });
    }

    const line = turn.done
      ? (turn.closing ?? `Your brand is ready. Take a look at ${turn.brand!.name}.`)
      : turn.question!;
    const tts = await speak(line, voice.id);

    return Response.json({
      userText: turn.userText,
      done: turn.done,
      question: turn.question,
      brand: turn.brand,
      line,
      speech: tts.speech,
      words: tts.words,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed';
    // Never dump raw provider JSON at the creator — map to a calm, human line.
    const friendly = TRANSIENT.test(msg)
      ? 'Venus is in high demand right now — give it a sec, then tap to try again.'
      : 'Hmm, that didn’t go through — tap to try again.';
    return Response.json({ error: friendly }, { status: 502 });
  }
}
