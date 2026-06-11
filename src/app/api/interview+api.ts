import { GoogleGenAI } from '@google/genai';

import { getUserFromRequest } from '@/lib/auth';

// POST /api/interview — the Studio brand interview. The client sends the chat so far;
// the model either asks the next question or, once it knows enough, returns the
// finished brand profile + design system (done: true).
const MODEL = 'gemini-2.5-flash';

type ChatMessage = { role: 'user' | 'assistant'; text: string };

export type BrandResult = {
  name: string;
  tagline: string;
  mission: string;
  audience: string;
  voice: string;
  story: string;
  vibeKeywords: string[];
  designSystem: {
    palette: { role: string; hex: string }[];
    typography: { display: string; body: string };
    texture: string[];
    motion: string[];
  };
};

const SYSTEM = `You are Nanocrew's brand builder — a sharp, friendly creative director interviewing a
creator to define their clothing brand. One question at a time, conversational, no lists of
questions. Cover, in roughly this order: what the brand is about / its name idea; the vibe or
aesthetic; who it's for; influences or characters or stories behind it; how it should feel
(voice/personality). Keep questions short and build on their answers.

After you have enough (at most 5 questions — fewer if their answers are rich), stop asking and
produce the brand.

ALWAYS reply with ONLY a JSON object, no markdown fences, in one of these two shapes:
  {"done": false, "question": "<your next single question>"}
or
  {"done": true, "brand": {
    "name": "<brand name>",
    "tagline": "<short tagline>",
    "mission": "<1-2 sentence mission>",
    "audience": "<who it's for>",
    "voice": "<brand voice/personality>",
    "story": "<short brand story/lore paragraph>",
    "vibeKeywords": ["<3-6 keywords>"],
    "designSystem": {
      "palette": [{"role": "primary|secondary|accent|background|text", "hex": "#RRGGBB"}],
      "typography": {"display": "<display font style, e.g. 'heavy condensed sans'>", "body": "<body font style>"},
      "texture": ["<2-4 texture/material cues>"],
      "motion": ["<2-3 motion-language cues>"]
    }
  }}
The palette must have exactly 5 entries (primary, secondary, accent, background, text) with
real hex values that suit the vibe.`;

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
        systemInstruction: SYSTEM,
        temperature: 0.9,
        responseMimeType: 'application/json',
      },
    });
    const raw = res.text?.trim();
    if (!raw) throw new Error('empty response');
    const parsed = JSON.parse(raw) as { done: boolean; question?: string; brand?: BrandResult };
    if (!parsed.done && !parsed.question) throw new Error('malformed response');
    if (parsed.done && !parsed.brand?.name) throw new Error('malformed brand');
    return Response.json(parsed);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 502 });
  }
}
