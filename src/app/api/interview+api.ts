import { GoogleGenAI } from '@google/genai';

import { getUserFromRequest } from '@/lib/auth';
import { interviewSystem, parseTurn, type ChatMessage } from '@/lib/interview';

// POST /api/interview — the text version of the Studio brand interview (the voice route
// /api/voice is the primary experience; this stays for fallback/testing).
const MODEL = 'gemini-2.5-flash';

const TRANSIENT = /unavailable|overloaded|try again|503|429|rate.?limit|deadline|temporar/i;

async function generateWithRetry(
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI['models']['generateContent']>[0],
  attempts = 3,
) {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await ai.models.generateContent(params);
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!TRANSIENT.test(msg) || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }
  throw lastErr;
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: 'GOOGLE_GENAI_API_KEY not configured' }, { status: 500 });

  let messages: ChatMessage[];
  try {
    const body = (await req.json()) as { messages?: ChatMessage[] };
    messages = (body.messages ?? []).slice(-30);
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await generateWithRetry(ai, {
      model: MODEL,
      contents: messages.length
        ? messages.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }))
        : [{ role: 'user', parts: [{ text: 'Start the interview with your first question.' }] }],
      config: {
        systemInstruction: interviewSystem(user.name),
        temperature: 0.9,
        responseMimeType: 'application/json',
      },
    });
    const raw = res.text?.trim();
    if (!raw) throw new Error('empty response');
    return Response.json(parseTurn(raw));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed';
    const friendly = TRANSIENT.test(msg)
      ? 'Venus is in high demand right now — give it a sec, then try again.'
      : 'Hmm, that didn’t go through — try again.';
    return Response.json({ error: friendly }, { status: 502 });
  }
}
