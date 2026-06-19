import { GoogleGenAI } from '@google/genai';

import { getUserFromRequest } from '@/lib/auth';
import type { ChatMessage } from '@/lib/interview';
import { guardRate } from '@/lib/rate-limit';

// POST /api/creator/plan-site-edits { messages: ChatMessage[] }
//   → { images: [{ slot:'hero'|'logo'|'og', prompt }], edits: string[] }
//
// The live-site voice editor (site-preview critique) captures a free-form conversation. Native-audio
// Live can't reliably call tools, so a TEXT model distills the talk into a plan: which requests are
// "generate NEW artwork for a known slot" (→ generate + place via /api/creator/site-assets) vs. every
// other change (→ the forge). Closers/greetings/clarifying confirmations are dropped. Same brain
// pattern as /api/extract-brand.
const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];
const TRANSIENT = /unavailable|overloaded|try again|503|429|rate.?limit|deadline|temporar/i;

const SYSTEM = `You read a short conversation in which a creator described changes to their EXISTING brand website (they were circling parts of the page and talking). Output ONLY JSON of the shape:
{"images":[{"slot":"hero|logo|og","prompt":"<vivid description of the image to generate>"}],"edits":["<other change as a short imperative>"]}

Rules:
- "images" = ONLY requests to GENERATE brand-NEW artwork for a known slot: the HERO image (slot "hero"), the logo (slot "logo"), or the social/share card (slot "og"). IMPORTANT: the hero image IS the big full-bleed background image at the top of the site, so map ALL of these to slot "hero": "hero", "background", "background image", "the background", "the photo/image at the top", "the image behind the headline/text", "the banner image". The prompt must be a clear, vivid image description (combine the whole conversation so a fragmented ask like "change the background" + "a beach at sunset" becomes one prompt). Only include an image when the creator clearly wants it generated.
- "edits" = EVERY other change in plain imperative words: text/headlines, colors, layout, moving or resizing things, rounder buttons, swapping to a photo they already have, adding sections, etc.
- IGNORE greetings, acknowledgements, confirmations ("yes", "do it", "that's it"), and anything that isn't an actual change.
- If you're unsure whether something is a new-image generation, put it in "edits", not "images".
- Never invent changes that weren't asked for. Empty arrays are fine.`;

async function generate(ai: GoogleGenAI, params: Parameters<GoogleGenAI['models']['generateContent']>[0], attempts = 2) {
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

const VALID_SLOTS = new Set(['hero', 'logo', 'og']);

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const limited = await guardRate(`plan-edits:${user.id}`, 30, 60);
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
    const transcript = messages.map((m) => `${m.role === 'user' ? 'Creator' : 'Venus'}: ${m.text}`).join('\n');
    const res = await generate(ai, {
      model: MODELS[0],
      contents: [{ role: 'user', parts: [{ text: `Conversation:\n${transcript}\n\nReturn the JSON plan.` }] }],
      config: { systemInstruction: SYSTEM, temperature: 0.2, responseMimeType: 'application/json' },
    });
    const raw = res.text?.trim();
    if (!raw) throw new Error('empty');
    const parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '')) as {
      images?: { slot?: string; prompt?: string }[];
      edits?: string[];
    };
    const images = (parsed.images ?? [])
      .filter((i) => i && typeof i.prompt === 'string' && i.prompt.trim() && VALID_SLOTS.has(String(i.slot)))
      .map((i) => ({ slot: i.slot as 'hero' | 'logo' | 'og', prompt: i.prompt!.trim() }))
      .slice(0, 6);
    const edits = (parsed.edits ?? []).filter((e) => typeof e === 'string' && e.trim()).map((e) => e.trim()).slice(0, 20);
    // Trace the classification: the most recent creator turn in → the plan out. When a request
    // like "make the hero an american flag" yields images=0, the subject was lost upstream (capture).
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.text ?? '';
    console.log(`[pipeline:plan] turns=${messages.length} lastSaid=${JSON.stringify(lastUser.slice(0, 160))} → images=${images.length}[${images.map((i) => i.slot).join(',')}] edits=${edits.length}`);
    return Response.json({ images, edits });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed';
    return Response.json({ error: TRANSIENT.test(msg) ? 'Busy — try again in a moment.' : 'Could not plan the edits.' }, { status: 502 });
  }
}
