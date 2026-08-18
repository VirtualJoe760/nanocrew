import { GoogleGenAI } from '@google/genai';

import { getUserFromRequest } from '@/lib/auth';
import { guardRate } from '@/lib/rate-limit';

// POST /api/eve/route — Eve's VOICE-INTENT ROUTER (docs/studio/VENUS_CENTRAL.md §3).
//
// Native-audio Gemini Live can't do reliable tool-calling, so the client distills instead: every
// committed user turn in Eve's home state is POSTed here (~300ms flash call, non-blocking) and a
// hit transitions her surface (edit-site → developing, new-design → the design bus, …).
//
// PRECISION over recall by design: a missed command costs the user a repeat; a false positive
// yanks them out of a conversation mid-sentence. When in doubt → 'none'. And the router must
// never break the session — every failure path returns { intent: 'none' }, not an error.

const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];
const TRANSIENT = /unavailable|overloaded|try again|503|429|rate.?limit|deadline|temporar/i;

const INTENTS = new Set(['create-brand', 'edit-site', 'new-design', 'site-asset', 'write-post', 'digest', 'done', 'none'] as const);
type Intent = 'create-brand' | 'edit-site' | 'new-design' | 'site-asset' | 'write-post' | 'digest' | 'done' | 'none';

const SYSTEM = `You classify ONE spoken utterance from a clothing-brand creator talking with Eve, their AI studio assistant. Decide whether it is a CLEAR task command to switch what they're working on, and respond with STRICT JSON only:
{"intent":"create-brand"|"edit-site"|"new-design"|"site-asset"|"write-post"|"digest"|"done"|"none","storeSlug":"...","idea":"...","slot":"hero"|"logo"|"mark"|"favicon"|"og","topic":"...","ask":"..."}
(omit fields that don't apply)

Intents:
- "edit-site": they clearly want to change/edit/fix their EXISTING website ("I want to edit my site", "let's change the homepage", "can we update the hero on my store"). If the utterance names one of the provided stores, set storeSlug to that store's slug (must be from the list). If several stores could match and it's ambiguous, keep intent "edit-site", omit storeSlug, and set ask to a one-line question naming the options.
- "create-brand": they clearly want to start/build a NEW brand ("let's build another brand", "I want to start a new label").
- "new-design": they clearly ask to create a design, graphic, or meme ("make me a meme about mondays", "new tee design with a chrome skull"). Put their concept in idea, short. idea is the ARTWORK to print — the graphic itself, never the garment carrying it: "new tee design with a chrome skull" → idea "chrome skull graphic"; "make me a t-shirt" (no subject given) → idea omitted, so Eve asks what goes on it.
- "site-asset": they ask for a graphic FOR THEIR WEBSITE — a hero/banner image, a logo, or a social/share card ("new hero for my site", "make me a logo", "redo the banner"). idea = the graphic concept, short (omit if they gave none). slot = "hero" for hero/banner/header imagery, "logo" for the wide wordmark logo, "mark" for the square icon / app icon, "favicon" when they specifically say favicon or browser-tab icon, "og" for the social/share/preview card; omit slot when they didn't say which. A design for a PRODUCT (tee, hoodie, print) is "new-design", not this.
- "write-post": they clearly ask to write/draft a blog post. topic = short topic.
- "digest": they ASK how their store/brand is doing, for stats, sales, orders, views, revenue, or a status update ("how am I doing", "yes" to a digest offer, "show my numbers", "any sales?"). Statements ABOUT sales or news that don't ask for numbers ("we sold out at the market last weekend") are conversation → "none".
- "done": they are clearly finished with Eve ("that's all for now", "we're done", "goodbye Eve").
- "none": EVERYTHING else — answers to Eve's questions, brand-interview content (names, products, colors, style talk), chit-chat, thinking aloud, vague wishes. PRECISION over recall: when in doubt, return "none".

If interviewActive is true they are mid brand-interview: near-everything is interview content — return "none" unless the utterance is an explicit redirect AWAY from it ("actually forget this, I want to edit my site instead"). Even a clear-sounding task ("make me a design of a skull") is interview content mid-interview — they are describing their brand's products/graphics, not leaving the interview → "none".`;

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

const NONE = { intent: 'none' as const };

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  // Per-turn cadence — one call per committed utterance; 60/min is generous headroom.
  const limited = await guardRate(`eve-route:${user.id}`, 60, 60);
  if (limited) return limited;

  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json(NONE);

  let turn: string;
  let recent: { role: string; text: string }[];
  let stores: { name: string; slug: string; hasSite: boolean }[];
  let interviewActive: boolean;
  let awaitingDesignIdea: boolean;
  let awaitingAssetIdea: boolean;
  try {
    const body = (await req.json()) as {
      turn?: string;
      recent?: { role: string; text: string }[];
      stores?: { name: string; slug: string; hasSite?: boolean }[];
      interviewActive?: boolean;
      awaitingDesignIdea?: boolean;
      awaitingAssetIdea?: boolean;
    };
    turn = (body.turn ?? '').trim().slice(0, 600);
    if (!turn) throw new Error();
    recent = (body.recent ?? []).slice(-6).map((m) => ({ role: m.role === 'user' ? 'Creator' : 'Eve', text: String(m.text).slice(0, 300) }));
    stores = (body.stores ?? []).slice(0, 12).map((s) => ({ name: String(s.name).slice(0, 80), slug: String(s.slug).slice(0, 80), hasSite: !!s.hasSite }));
    interviewActive = !!body.interviewActive;
    awaitingDesignIdea = !!body.awaitingDesignIdea;
    awaitingAssetIdea = !!body.awaitingAssetIdea;
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const brief = [
      `Stores: ${stores.length ? stores.map((s) => `"${s.name}" (slug: ${s.slug}${s.hasSite ? ', has a live site' : ', NO site yet'})`).join('; ') : 'none'}`,
      `interviewActive: ${interviewActive}`,
      // The one exception to precision-bias: Eve JUST asked what they'd like designed, so a bare
      // subject ("a chrome skull", "something with wolves") IS the answer — new-design with that
      // concept as idea. Refusals, deflections, and other topics still classify normally.
      awaitingDesignIdea
        ? 'awaitingDesignIdea: true — Eve just asked what design/artwork they want made. If this utterance names a subject or concept (even a bare noun phrase), classify it as "new-design" with idea = that concept as printable artwork. If they decline or change the subject, classify normally.'
        : '',
      awaitingAssetIdea
        ? 'awaitingAssetIdea: true — Eve just asked what WEBSITE graphic they want (and for which spot). If this utterance names a subject/concept (even a bare noun phrase), classify it as "site-asset" with idea = that concept, and slot when they named hero/banner, logo, or social card. If they decline or change the subject, classify normally.'
        : '',
      recent.length ? `Recent conversation:\n${recent.map((m) => `${m.role}: ${m.text}`).join('\n')}` : '',
      `Utterance: "${turn}"`,
      'Return the JSON.',
    ]
      .filter(Boolean)
      .join('\n\n');
    const res = await generate(ai, {
      model: MODELS[0],
      contents: [{ role: 'user', parts: [{ text: brief }] }],
      config: { systemInstruction: SYSTEM, temperature: 0, responseMimeType: 'application/json' },
    });
    const raw = res.text?.trim();
    if (!raw) return Response.json(NONE);
    const parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '')) as {
      intent?: string;
      storeSlug?: string;
      idea?: string;
      topic?: string;
      ask?: string;
    };
    const intent = (INTENTS.has(parsed.intent as Intent) ? parsed.intent : 'none') as Intent;
    // storeSlug must be one of the caller's stores — the model may not invent targets.
    const storeSlug = stores.some((s) => s.slug === parsed.storeSlug) ? parsed.storeSlug : undefined;
    const out = {
      intent,
      ...(intent === 'edit-site' && storeSlug ? { storeSlug } : {}),
      ...(intent === 'edit-site' && parsed.ask ? { ask: String(parsed.ask).slice(0, 200) } : {}),
      ...(intent === 'new-design' && parsed.idea ? { idea: String(parsed.idea).slice(0, 300) } : {}),
      ...(intent === 'site-asset' && parsed.idea ? { idea: String(parsed.idea).slice(0, 300) } : {}),
      ...(intent === 'site-asset' && ['hero', 'logo', 'mark', 'favicon', 'og'].includes((parsed as { slot?: string }).slot ?? '')
        ? { slot: (parsed as { slot?: string }).slot }
        : {}),
      ...(intent === 'site-asset' && storeSlug ? { storeSlug } : {}),
      ...(intent === 'write-post' && parsed.topic ? { topic: String(parsed.topic).slice(0, 200) } : {}),
    };
    if (intent !== 'none') console.log(`[eve:route] "${turn.slice(0, 80)}" → ${JSON.stringify(out)}`);
    return Response.json(out);
  } catch {
    return Response.json(NONE); // routing is best-effort — never surface an error mid-conversation
  }
}
