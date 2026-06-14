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


/** Subtle sci-fi room reverb via ffmpeg, when the host has it. Falls back to dry audio. */
async function addReverb(mp3: Buffer): Promise<Buffer> {
  try {
    const { execFileSync } = await import('node:child_process');
    const { writeFileSync, readFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const base = `${tmpdir()}/entity-${process.pid}-${Math.random().toString(36).slice(2)}`;
    writeFileSync(`${base}.mp3`, mp3);
    execFileSync(
      'ffmpeg',
      // Gentle tempo pull-down (delicate pace) + a subtle sci-fi room echo.
      ['-y', '-i', `${base}.mp3`, '-af', 'atempo=0.87,aecho=0.8:0.55:38|57:0.16|0.10', '-b:a', '64k', `${base}-wet.mp3`],
      { stdio: 'ignore', timeout: 10000 },
    );
    const wet = readFileSync(`${base}-wet.mp3`);
    rmSync(`${base}.mp3`, { force: true });
    rmSync(`${base}-wet.mp3`, { force: true });
    return wet;
  } catch {
    return mp3; // no ffmpeg (or it failed) — ship the dry take
  }
}

const TEMPO = 0.87; // must match the atempo factor in addReverb

/** Map ElevenLabs character alignment → per-word start times, scaled for our tempo. */
function toWordTimings(chars: string[], starts: number[]): TimedWord[] {
  const words: TimedWord[] = [];
  let current = '';
  let start = 0;
  chars.forEach((c, i) => {
    if (/\s/.test(c)) {
      if (current) words.push({ w: current, t: start / TEMPO });
      current = '';
    } else {
      if (!current) start = starts[i] ?? 0;
      current += c;
    }
  });
  if (current) words.push({ w: current, t: start / TEMPO });
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
  const speech = (await addReverb(dry)).toString('base64');
  const words = data.alignment
    ? toWordTimings(data.alignment.characters, data.alignment.character_start_times_seconds)
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
      let uploadErr: string | undefined;
      let uploaded: string | undefined;
      if (publicId) {
        uploaded = await uploadRaw(Buffer.from(JSON.stringify(tts)), publicId).catch((e) => {
          uploadErr = e instanceof Error ? e.message : String(e);
          return undefined;
        });
      }
      return Response.json({
        line: say,
        speech: tts.speech,
        words: tts.words,
        debug: { cloud: !!process.env.CLOUDINARY_CLOUD_NAME, pid: publicId, uploaded, uploadErr },
      });
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

    const res = await ai.models.generateContent({
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
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 502 });
  }
}
