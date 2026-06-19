import { GoogleGenAI } from '@google/genai';

import { getUserFromRequest } from '@/lib/auth';
import { interviewSystem, parseTurn, type ChatMessage } from '@/lib/interview';
import { guardRate } from '@/lib/rate-limit';

// POST /api/extract-brand { messages: ChatMessage[] } → BrandResult
// Reliable brand finalize for the Gemini Live flow: native-audio Live models don't reliably emit
// the save_brand tool call, so instead we accumulate the spoken transcript and extract the brand
// with a TEXT model here (which reliably returns the structured JSON). Same brain as /api/interview.
const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];
const TRANSIENT = /unavailable|overloaded|try again|503|429|rate.?limit|deadline|temporar/i;

async function generateWithRetry(ai: GoogleGenAI, params: Parameters<GoogleGenAI['models']['generateContent']>[0], attempts = 2) {
  let lastErr: unknown;
  for (const model of MODELS) {
    for (let i = 0; i < attempts; i++) {
      try {
        return await ai.models.generateContent({ ...params, model });
      } catch (e) {
        lastErr = e;
        if (!TRANSIENT.test(e instanceof Error ? e.message : String(e))) throw e;
        await new Promise((r) => setTimeout(r, 600 * (i + 1)));
      }
    }
  }
  throw lastErr;
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const limited = await guardRate(`extract:${user.id}`, 20, 60);
  if (limited) return limited;

  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: 'GOOGLE_GENAI_API_KEY not configured' }, { status: 500 });

  let messages: ChatMessage[];
  try {
    const body = (await req.json()) as { messages?: ChatMessage[] };
    messages = (body.messages ?? []).slice(-40);
    if (!messages.length) throw new Error();
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const history = messages.map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('model' as const),
      parts: [{ text: m.text }],
    }));
    const res = await generateWithRetry(ai, {
      model: MODELS[0],
      contents: [
        ...history,
        {
          role: 'user',
          parts: [{
            text: 'The interview is complete. Based on the whole conversation above, output the FINAL brand now — respond with done:true and the full brand object per the contract. Make sensible, on-brand choices for anything not explicitly discussed.',
          }],
        },
      ],
      config: { systemInstruction: interviewSystem(user.name), temperature: 0.7, responseMimeType: 'application/json' },
    });
    const raw = res.text?.trim();
    if (!raw) throw new Error('empty response');
    const turn = parseTurn(raw);
    if (!turn.brand) return Response.json({ error: 'could not extract a brand yet' }, { status: 422 });
    return Response.json({ brand: turn.brand });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed';
    return Response.json({ error: TRANSIENT.test(msg) ? 'Busy right now — try again in a moment.' : 'Could not build the brand — try again.' }, { status: 502 });
  }
}
