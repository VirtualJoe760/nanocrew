import { GoogleGenAI } from '@google/genai';

import { getUserFromRequest } from '@/lib/auth';
import { GENERATABLE_GUIDANCE } from '@/lib/content-safety';
import { clampEffort, ideaGuidance } from '@/lib/effort';
import { guardRate } from '@/lib/rate-limit';

// GET /api/idea?effort=1..4 → one random AI-invented clothing-graphic prompt (the 🎲 button).
// `effort` dictates how detailed the invented concept is.
const MODEL = 'gemini-2.5-flash';

const VIBES = [
  'streetwear',
  'vintage surf',
  'cyberpunk',
  'cottagecore',
  'skate culture',
  'retro-futurism',
  'lo-fi music',
  'outdoors / national park',
  'tattoo flash',
  'anime-inspired',
  'sports jersey',
  'minimalist line art',
  'psychedelic',
  'gothic blackletter',
  'y2k chrome',
];

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const limited = await guardRate(`ai:${user.id}`, 60, 60);
  if (limited) return limited;
  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: 'GOOGLE_GENAI_API_KEY not configured' }, { status: 500 });
  const effort = clampEffort(new URL(req.url).searchParams.get('effort'));
  const vibe = VIBES[Math.floor(Math.random() * VIBES.length)];
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
                `Invent ONE original clothing-graphic concept in the "${vibe}" vibe. ` +
                `${ideaGuidance(effort)} Specific and visual. ${GENERATABLE_GUIDANCE} ` +
                'Reply with ONLY the design prompt itself — no quotes, no preamble.',
            },
          ],
        },
      ],
      config: { temperature: 1.3 },
    });
    const idea = res.text?.trim().replace(/^["']|["']$/g, '');
    if (!idea) throw new Error('no idea returned');
    return Response.json({ idea });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 502 });
  }
}
