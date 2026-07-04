import { GoogleGenAI, Modality } from '@google/genai';
import { and, eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { uploadImage } from '@/lib/cloudinary';
import { ContentSafetyError, IMAGE_SAFETY_SETTINGS, assertSafePrompt } from '@/lib/content-safety';
import { guardRate } from '@/lib/rate-limit';
import { TenantError, assertCatalogueOwner } from '@/lib/tenant';
import { safeImageFetch } from '@/lib/safe-fetch';
import { CREDIT_COSTS, debit, grant, InsufficientCreditsError } from '@/lib/credits';

// POST /api/edit — the design EDITOR: feed Nano Banana ONE existing design + a natural-language
// instruction shaped by an edit MODE (semantic inpainting / lettering swap / concept remix /
// custom), and store the result as a NEW design row (non-destructive — the original stays).
// Mirrors /api/merge's discipline: ownership-scoped, credit-gated debit-then-refund, 3× retry,
// magenta keying for transparent product graphics.
const MODEL = 'gemini-2.5-flash-image';

export type EditMode = 'inpaint' | 'text' | 'remix' | 'custom';

// Mode → how the instruction is framed for the model. Nano Banana does region edits and lettering
// swaps from DESCRIPTIONS (no masks — Imagen's mask APIs are deprecated; semantic editing is the
// supported path). Each template pins down what must NOT change, which is what makes edits read as
// edits instead of regenerations.
function buildInstruction(mode: EditMode, instruction: string, transparent: boolean): string {
  const keep =
    'Preserve everything not mentioned EXACTLY as-is — same composition, style, colours, lighting and level of detail.';
  const body =
    mode === 'inpaint'
      ? `Edit ONLY the part of this graphic described here: ${instruction}. ${keep}`
      : mode === 'text'
        ? `Change ONLY the text/lettering in this graphic as instructed: ${instruction}. Keep the same font style, weight, effects, layout and placement — swap the words, not the look. ${keep}`
        : mode === 'remix'
          ? `Reimagine the IDEA behind this graphic: ${instruction}. Keep the same overall layout, style language and quality — the concept changes, the aesthetic stays.`
          : `Apply this edit to the graphic: ${instruction}. ${keep}`;
  const bg = transparent
    ? ' Render the result centered on a SOLID, UNIFORM, PURE MAGENTA (#FF00FF) background filling the entire frame; the artwork itself must contain NO magenta or pink hues.'
    : '';
  return `${body} High resolution, print-quality output. No watermark.${bg}`;
}

interface InlinePart {
  inlineData?: { data?: string; mimeType?: string };
  text?: string;
}
interface GenResponse {
  candidates?: { content?: { parts?: InlinePart[] } }[];
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

  const charge = user.email !== 'internal@nanocrew';
  let debited = false;
  let refunded = false;
  let refundRef: string | undefined;
  const refund = () => {
    if (charge && debited && !refunded) {
      refunded = true;
      void grant(user.id, CREDIT_COSTS.design_edit, 'refund', refundRef).catch(() => {});
    }
  };

  try {
    const body = (await req.json().catch(() => null)) as {
      designId?: string;
      catalogueId?: string;
      instruction?: string;
      mode?: EditMode;
      background?: 'transparent' | 'filled';
    } | null;
    const instruction = body?.instruction?.trim();
    if (!body?.designId || !body.catalogueId || !instruction) {
      return Response.json({ error: 'designId, catalogueId, instruction required' }, { status: 400 });
    }
    const mode: EditMode = body.mode ?? 'custom';
    const transparent = body.background !== 'filled'; // product graphics are cutouts by default
    const storeId = await assertCatalogueOwner(body.catalogueId, user.id);

    // Scope to the caller's own store — never edit another creator's (private) design.
    const [design] = await db
      .select({ id: schema.designs.id, url: schema.designs.url, prompt: schema.designs.prompt })
      .from(schema.designs)
      .where(and(eq(schema.designs.id, body.designId), eq(schema.designs.storeId, storeId)))
      .limit(1);
    if (!design) return Response.json({ error: 'design not found' }, { status: 404 });

    const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!apiKey) return Response.json({ error: 'GOOGLE_GENAI_API_KEY not configured' }, { status: 500 });

    try {
      assertSafePrompt(instruction);
    } catch (e) {
      if (e instanceof ContentSafetyError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }

    // Charge before the model spend.
    refundRef = design.id;
    if (charge) {
      try {
        await debit(user.id, 'design_edit', design.id);
        debited = true;
      } catch (e) {
        if (e instanceof InsufficientCreditsError) {
          return Response.json({ error: 'insufficient_credits', needed: e.needed, balance: e.balance }, { status: 402 });
        }
        throw e;
      }
    }

    const prompt = buildInstruction(mode, instruction, transparent);
    const ai = new GoogleGenAI({ apiKey });
    const source = await urlToInline(design.url);

    let lastErr = 'No image returned';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = (await ai.models.generateContent({
          model: MODEL,
          contents: [{ role: 'user', parts: [{ text: prompt }, source] }],
          config: { responseModalities: [Modality.IMAGE], safetySettings: IMAGE_SAFETY_SETTINGS },
        })) as GenResponse;
        for (const part of res.candidates?.[0]?.content?.parts ?? []) {
          if (part.inlineData?.data) {
            let buffer: Buffer = Buffer.from(part.inlineData.data, 'base64');
            if (transparent) {
              try {
                const { keyOutMagenta } = await import('@/lib/transparency');
                buffer = (await keyOutMagenta(buffer)) as Buffer;
              } catch {
                // ship unkeyed rather than fail
              }
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
                prompt: `Edit — ${instruction.slice(0, 80)}`,
                url,
              })
              .returning({ id: schema.designs.id, prompt: schema.designs.prompt });
            return Response.json({ image: url, id: row.id, prompt: row.prompt });
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/RESOURCE_EXHAUSTED|quota|\b429\b|PERMISSION_DENIED|\b40[134]\b/i.test(msg)) {
          refund();
          return Response.json({ error: msg }, { status: 502 });
        }
        lastErr = msg;
      }
    }
    refund();
    return Response.json({ error: lastErr }, { status: 502 });
  } catch (e) {
    refund();
    const status = e instanceof TenantError ? e.status : 502;
    return Response.json({ error: e instanceof Error ? e.message : 'Edit failed' }, { status });
  }
}
