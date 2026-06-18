import { GoogleGenAI, Modality } from '@google/genai';
import { and, eq, inArray } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { uploadImage } from '@/lib/cloudinary';
import { ContentSafetyError, IMAGE_SAFETY_SETTINGS, assertSafePrompt } from '@/lib/content-safety';
import { guardRate } from '@/lib/rate-limit';
import { TenantError, assertCatalogueOwner } from '@/lib/tenant';
import { safeImageFetch } from '@/lib/safe-fetch';

// POST /api/merge — the blend tool: feed Nano Banana BOTH design images plus the
// collision prompt, key the result transparent, store it as a new design.
const MODEL = 'gemini-2.5-flash-image';

interface InlinePart {
  inlineData?: { data?: string; mimeType?: string };
  text?: string;
}
interface GenResponse {
  candidates?: Array<{ content?: { parts?: InlinePart[] } }>;
}

async function urlToInline(url: string): Promise<InlinePart> {
  const res = await safeImageFetch(url);
  if (!res.ok) throw new Error(`Failed to fetch design (${res.status})`);
  return {
    inlineData: {
      mimeType: res.headers.get('content-type') ?? 'image/png',
      data: Buffer.from(await res.arrayBuffer()).toString('base64'),
    },
  };
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const limited = await guardRate(`gen:${user.id}`, 20, 60);
  if (limited) return limited;
  try {
    const body = (await req.json().catch(() => null)) as {
      designAId?: string;
      designBId?: string;
      prompt?: string;
      catalogueId?: string;
    } | null;
    if (!body?.designAId || !body.designBId || !body.catalogueId) {
      return Response.json({ error: 'designAId, designBId, catalogueId required' }, { status: 400 });
    }
    const storeId = await assertCatalogueOwner(body.catalogueId, user.id);

    // Scope to the caller's own store — never fuse another creator's (private) designs.
    const rows = await db
      .select({ id: schema.designs.id, url: schema.designs.url, prompt: schema.designs.prompt })
      .from(schema.designs)
      .where(
        and(
          inArray(schema.designs.id, [body.designAId, body.designBId]),
          eq(schema.designs.storeId, storeId),
        ),
      );
    const a = rows.find((r) => r.id === body.designAId);
    const b = rows.find((r) => r.id === body.designBId);
    if (!a || !b) return Response.json({ error: 'designs not found' }, { status: 404 });

    const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!apiKey) return Response.json({ error: 'GOOGLE_GENAI_API_KEY not configured' }, { status: 500 });

    try {
      assertSafePrompt(body.prompt);
    } catch (e) {
      if (e instanceof ContentSafetyError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
    const collision = body.prompt?.trim() || 'fuse the two graphics into one cohesive design';
    const instruction =
      'Merge the two provided graphics into ONE new clothing graphic suitable for ' +
      `direct-to-garment printing. How they collide: ${collision}. High contrast. ` +
      'Place the result centered on a SOLID, UNIFORM, PURE MAGENTA (#FF00FF) background ' +
      'filling the entire frame. The artwork itself must contain NO magenta or pink hues.';

    const ai = new GoogleGenAI({ apiKey });
    const [imgA, imgB] = await Promise.all([urlToInline(a.url), urlToInline(b.url)]);

    let lastErr = 'No image returned';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = (await ai.models.generateContent({
          model: MODEL,
          contents: [{ role: 'user', parts: [{ text: instruction }, imgA, imgB] }],
          config: { responseModalities: [Modality.IMAGE], safetySettings: IMAGE_SAFETY_SETTINGS },
        })) as GenResponse;
        for (const part of res.candidates?.[0]?.content?.parts ?? []) {
          if (part.inlineData?.data) {
            let buffer: Buffer = Buffer.from(part.inlineData.data, 'base64');
            try {
              const { keyOutMagenta } = await import('@/lib/transparency');
              buffer = (await keyOutMagenta(buffer)) as Buffer;
            } catch {
              // ship unkeyed rather than fail
            }
            let url: string;
            try {
              url = await uploadImage(buffer, { folder: 'nanocrew/designs' });
            } catch {
              url = `data:image/png;base64,${buffer.toString('base64')}`;
            }
            const [row] = await db
              .insert(schema.designs)
              .values({
                storeId,
                catalogueId: body.catalogueId,
                prompt: `Merge — ${collision.slice(0, 80)}`,
                url,
              })
              .returning({ id: schema.designs.id });
            return Response.json({ image: url, id: row.id });
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/RESOURCE_EXHAUSTED|quota|\b429\b|PERMISSION_DENIED|\b40[134]\b/i.test(msg)) {
          return Response.json({ error: msg }, { status: 502 });
        }
        lastErr = msg;
      }
    }
    return Response.json({ error: lastErr }, { status: 502 });
  } catch (e) {
    const status = e instanceof TenantError ? e.status : 502;
    return Response.json({ error: e instanceof Error ? e.message : 'Merge failed' }, { status });
  }
}
