import { GoogleGenAI } from '@google/genai';

import { getUserFromRequest } from '@/lib/auth';
import { clampEffort, enhanceGuidance } from '@/lib/effort';
import { guardRate } from '@/lib/rate-limit';

// POST /api/enhance { prompt, effort?: 1..4 } → a lazy prompt ("panda") expanded into a
// rich, vivid image-generation prompt (the ✨ button next to 🎲). `effort` dictates how far
// it elaborates.
const MODEL = 'gemini-2.5-flash';

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const limited = await guardRate(`ai:${user.id}`, 60, 60);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { prompt?: string; effort?: number } | null;
  const prompt = body?.prompt?.trim();
  if (!prompt) return Response.json({ error: 'prompt required' }, { status: 400 });
  const effort = clampEffort(body?.effort);

  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: 'GOOGLE_GENAI_API_KEY not configured' }, { status: 500 });

  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                `Expand this terse clothing-design idea into an image-generation prompt: ` +
                `"${prompt}". Keep the exact same subject and intent. ${enhanceGuidance(effort)} ` +
                'Reply with ONLY the enhanced prompt — no quotes, no preamble.',
            },
          ],
        },
      ],
      config: { temperature: 0.9 },
    });
    const enhanced = res.text?.trim().replace(/^["']|["']$/g, '');
    if (!enhanced) throw new Error('no enhancement returned');
    return Response.json({ enhanced });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 502 });
  }
}
