import { GoogleGenAI } from '@google/genai';

import { getUserFromRequest } from '@/lib/auth';
import { INTERVIEW_SYSTEM, parseTurn, type ChatMessage } from '@/lib/interview';

// POST /api/interview — the text version of the Studio brand interview (the voice route
// /api/voice is the primary experience; this stays for fallback/testing).
const MODEL = 'gemini-2.5-flash';

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
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: messages.length
        ? messages.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }))
        : [{ role: 'user', parts: [{ text: 'Start the interview with your first question.' }] }],
      config: {
        systemInstruction: INTERVIEW_SYSTEM,
        temperature: 0.9,
        responseMimeType: 'application/json',
      },
    });
    const raw = res.text?.trim();
    if (!raw) throw new Error('empty response');
    return Response.json(parseTurn(raw));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 502 });
  }
}
