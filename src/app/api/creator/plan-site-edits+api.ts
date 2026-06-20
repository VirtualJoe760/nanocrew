import { GoogleGenAI } from '@google/genai';

import { getUserFromRequest } from '@/lib/auth';
import type { ChatMessage } from '@/lib/interview';
import { guardRate } from '@/lib/rate-limit';

// POST /api/creator/plan-site-edits { messages: ChatMessage[] }
//   → { images: [{ slot:'hero'|'logo'|'og', prompt }], edits: [{ instruction, assets?:[{ prompt }] }] }
//
// The live-site voice editor (site-preview critique) captures a free-form conversation. Native-audio
// Live can't reliably call tools, so a TEXT model distills the talk into a plan:
//   • images = a pure picture SWAP into a known slot → generate + place via /api/creator/site-assets (direct, instant).
//   • edits  = every other change → the forge. Each edit may carry `assets`: NEW images the forge
//              needs to carry out a STRUCTURAL change (a carousel, a gallery, "add 2 more images").
//              The app generates those, then hands the URLs to the forge alongside the marked screenshot.
// Closers/greetings/confirmations are dropped. Same brain pattern as /api/extract-brand.
const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];
const TRANSIENT = /unavailable|overloaded|try again|503|429|rate.?limit|deadline|temporar/i;

const SYSTEM = `You read a short conversation in which a creator described changes to their EXISTING brand website (they were marking up the page — a circle, arrow, or scribble — and talking). Output ONLY JSON of the shape:
{"images":[{"slot":"hero|logo|og","prompt":"<vivid image description>"}],"edits":["<the change as a short imperative>"],"assets":["<a NEW image (vivid description) the forge needs to GENERATE for a structural edit>"]}

Three buckets:
- "images" = a pure PICTURE SWAP into a known slot — just replace the picture, nothing structural. Slots: the HERO image (slot "hero"), the logo (slot "logo"), the social/share card (slot "og"). The hero IS the big full-bleed image at the top, so map ALL of these to "hero": "hero", "background", "background image", "the photo/image at the top", "the image behind the headline", "the banner image". The prompt must be a vivid image description (combine the whole conversation so "change the background" + "a beach at sunset" becomes one prompt). Use this bucket ONLY for "make this image a different picture".
- "edits" = EVERY other change, each a short imperative STRING. Includes text, colors, layout, moving/resizing, AND structural/behavioral changes to images (add a parallax effect, turn an image into a sliding carousel, make a section a photo gallery, animate it, add more images). Name the element ("the hero", "the about section image").
- "assets" = NEW images (vivid descriptions) the forge must GENERATE to carry out a structural edit — usually EMPTY. Add one per new picture a structural edit needs (e.g. "turn the hero into a carousel and add 2 more images" → 2 assets; "make the about section a 3-photo gallery" → up to 3). If the creator didn't say what they should look like, describe something on-brand that fits the section. The app generates these and hands their URLs to the forge.

Rules:
- IGNORE greetings, acknowledgements, confirmations ("yes", "do it", "that's it"), and anything that isn't an actual change.
- A plain "make this a different picture" → images. A change to how an image BEHAVES or is STRUCTURED (carousel, parallax, gallery, +more images) → edits, plus assets if it needs new pictures.
- If unsure whether something is a pure swap, put it in "edits".
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
    // Tolerate both shapes: the new `edits: string[]` + `assets: string[]`, and (defensively) an
    // older `edits: [{instruction, assets}]` if the model echoes it.
    const parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '')) as {
      images?: { slot?: string; prompt?: string }[];
      edits?: (string | { instruction?: string; assets?: ({ prompt?: string } | string)[] })[];
      assets?: ({ prompt?: string } | string)[];
    };
    const images = (parsed.images ?? [])
      .filter((i) => i && typeof i.prompt === 'string' && i.prompt.trim() && VALID_SLOTS.has(String(i.slot)))
      .map((i) => ({ slot: i.slot as 'hero' | 'logo' | 'og', prompt: i.prompt!.trim() }))
      .slice(0, 6);
    const asPrompt = (a: { prompt?: string } | string): string => (typeof a === 'string' ? a : (a?.prompt ?? '')).trim();
    // `edits` is a back-compatible STRING array (the OLD client renders these directly). If the model
    // returns objects, flatten to the instruction string and lift any nested asset prompts out.
    const liftedAssets: string[] = [];
    const edits = (parsed.edits ?? [])
      .map((e) => {
        if (typeof e === 'string') return e.trim();
        if (Array.isArray(e?.assets)) liftedAssets.push(...e.assets.map(asPrompt).filter(Boolean));
        return typeof e?.instruction === 'string' ? e.instruction.trim() : '';
      })
      .filter(Boolean)
      .slice(0, 20);
    // `assets` = NEW images a structural edit needs the forge to use (the NEW client reads this; the
    // OLD client ignores it). Capped to bound generation spend per submit.
    const assets = [...(parsed.assets ?? []).map(asPrompt), ...liftedAssets].filter(Boolean).slice(0, 8);
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.text ?? '';
    console.log(`[pipeline:plan] turns=${messages.length} lastSaid=${JSON.stringify(lastUser.slice(0, 160))} → images=${images.length}[${images.map((i) => i.slot).join(',')}] edits=${edits.length} forgeAssets=${assets.length}`);
    return Response.json({ images, edits, assets });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed';
    return Response.json({ error: TRANSIENT.test(msg) ? 'Busy — try again in a moment.' : 'Could not plan the edits.' }, { status: 502 });
  }
}
