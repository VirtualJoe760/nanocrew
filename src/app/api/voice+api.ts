import { GoogleGenAI } from '@google/genai';

import { getUserFromRequest } from '@/lib/auth';
import { INTERVIEW_SYSTEM, parseTurn, type ChatMessage } from '@/lib/interview';

// POST /api/voice — one spoken turn of the Studio brand interview.
// Body: { messages: ChatMessage[], audio?: base64 m4a, init?: true }
//   init: true  → no audio; generate the opening line.
// Returns: { userText?, done, question?, brand?, speech: base64 mp3 }
const MODEL = 'gemini-2.5-flash';

const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID ?? 'onwK4e9ZLuTAKqWW03F9'; // "Daniel" — British, precise

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
      ['-y', '-i', `${base}.mp3`, '-af', 'aecho=0.8:0.55:38|57:0.16|0.10', '-b:a', '64k', `${base}-wet.mp3`],
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

async function speak(text: string): Promise<string> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY not configured');
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE}?output_format=mp3_44100_64`,
    {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.55, similarity_boost: 0.75 },
      }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const dry = Buffer.from(await res.arrayBuffer());
  return (await addReverb(dry)).toString('base64');
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: 'GOOGLE_GENAI_API_KEY not configured' }, { status: 500 });

  let messages: ChatMessage[];
  let audio: string | undefined;
  let init = false;
  try {
    const body = (await req.json()) as { messages?: ChatMessage[]; audio?: string; init?: boolean };
    messages = (body.messages ?? []).slice(-30);
    audio = body.audio;
    init = !!body.init;
    if (!init && !audio) throw new Error();
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const history = messages.map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('model' as const),
      parts: [{ text: m.text }],
    }));
    const lastParts = init
      ? [{ text: 'Start the interview with your first spoken question.' }]
      : [
          { inlineData: { mimeType: 'audio/mp4', data: audio! } },
          { text: 'This audio is my answer. Continue per the contract.' },
        ];

    const res = await ai.models.generateContent({
      model: MODEL,
      contents: [...history, { role: 'user', parts: lastParts }],
      config: {
        systemInstruction: INTERVIEW_SYSTEM,
        temperature: 0.9,
        responseMimeType: 'application/json',
      },
    });
    const raw = res.text?.trim();
    if (!raw) throw new Error('empty model response');
    const turn = parseTurn(raw);

    const line = turn.done
      ? (turn.closing ?? `Your brand is ready. Take a look at ${turn.brand!.name}.`)
      : turn.question!;
    const speech = await speak(line);

    return Response.json({
      userText: turn.userText,
      done: turn.done,
      question: turn.question,
      brand: turn.brand,
      line,
      speech,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 502 });
  }
}
