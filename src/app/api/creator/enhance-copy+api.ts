import { eq } from 'drizzle-orm';
import { GoogleGenAI } from '@google/genai';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { guardRate } from '@/lib/rate-limit';
import { TenantError, storeForMember } from '@/lib/tenant';

// POST /api/creator/enhance-copy { storeSlug, field, value } → an AI-improved version of one
// mini-CMS copy field, in the brand's voice. Powers the ✦ Enhance button next to each text box in
// the Customize-site editor. Free + rate-limited (a tiny gemini-flash call), like /api/enhance.

const MODEL = 'gemini-2.5-flash';

// Per-field art direction so "enhance" respects the slot's length + role.
const FIELD_GUIDE: Record<string, string> = {
  heroHeadline: 'a short, striking hero headline — at most ~6 words, no period unless it lands',
  heroSubline: 'one supporting sentence under the headline — at most ~16 words',
  heroCta: 'a 2–4 word button label (e.g. "Shop the collection")',
  storyKicker: 'a 1–3 word section label (e.g. "Our story")',
  story: 'a vivid 2–3 sentence brand story in the brand voice — concrete, not generic',
  tagline: 'a short tagline — at most ~8 words',
};

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const limited = await guardRate(`ai:${user.id}`, 60, 60);
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as { storeSlug?: string; field?: string; value?: string } | null;
  const field = body?.field;
  if (!body?.storeSlug || !field || !FIELD_GUIDE[field]) {
    return Response.json({ error: 'storeSlug and a known field are required' }, { status: 400 });
  }
  const value = (body.value ?? '').trim();

  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: 'GOOGLE_GENAI_API_KEY not configured' }, { status: 500 });

  try {
    const store = await storeForMember(body.storeSlug, user.id);
    if (!store) return Response.json({ error: 'store not found' }, { status: 404 });
    const [row] = await db
      .select({ name: schema.stores.name, tagline: schema.stores.tagline, brandProfile: schema.stores.brandProfile })
      .from(schema.stores)
      .where(eq(schema.stores.id, store.id))
      .limit(1);

    const bp = (row?.brandProfile ?? {}) as { voice?: string; story?: string; vibeKeywords?: string[] };
    const context = [
      `Brand: ${row?.name ?? body.storeSlug}.`,
      row?.tagline ? `Tagline: ${row.tagline}.` : '',
      bp.voice ? `Voice: ${bp.voice}.` : '',
      bp.vibeKeywords?.length ? `Vibe: ${bp.vibeKeywords.join(', ')}.` : '',
    ].filter(Boolean).join(' ');

    const verb = value ? `Improve this ${field}` : `Write the ${field}`;
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                `You are a senior brand copywriter. ${context}\n` +
                `${verb} for this brand's website: write ${FIELD_GUIDE[field]}. ` +
                (value ? `Current text: "${value}". Keep its core intent but make it sharper and on-voice. ` : '') +
                'Reply with ONLY the finished text — no quotes, no preamble, no options.',
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
    const status = e instanceof TenantError ? e.status : 502;
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status });
  }
}
