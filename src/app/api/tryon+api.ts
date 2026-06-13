import { eq } from 'drizzle-orm';
import { GoogleGenAI, Modality } from '@google/genai';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { guardRate } from '@/lib/rate-limit';
import { uploadImage } from '@/lib/cloudinary';

// POST /api/tryon { selfie: dataURL, productId } — Nano Banana renders the person from
// the selfie wearing the product (same two-image pattern as composeOnGarment).
// PRIVACY: the selfie itself is never stored; only the generated try-on render is hosted
// (transient folder) so the app can display it.
const MODEL = 'gemini-2.5-flash-image';

interface InlinePart {
  inlineData?: { data?: string; mimeType?: string };
  text?: string;
}
interface GenResponse {
  candidates?: Array<{ content?: { parts?: InlinePart[] } }>;
}

async function urlToInline(url: string): Promise<InlinePart> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image (${res.status})`);
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
  const limited = await guardRate(`tryon:${user.id}`, 15, 60);
  if (limited) return limited;
  try {
    const body = (await req.json().catch(() => null)) as {
      selfie?: string;
      productId?: string;
    } | null;
    const selfie = body?.selfie;
    if (!selfie?.startsWith('data:') || !body?.productId) {
      return Response.json({ error: 'selfie (data URL) and productId required' }, { status: 400 });
    }

    const [product] = await db
      .select({ name: schema.products.name, imageUrl: schema.products.imageUrl })
      .from(schema.products)
      .where(eq(schema.products.id, body.productId))
      .limit(1);
    if (!product?.imageUrl) return Response.json({ error: 'product not found' }, { status: 404 });

    const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!apiKey) return Response.json({ error: 'GOOGLE_GENAI_API_KEY not configured' }, { status: 500 });

    const comma = selfie.indexOf(',');
    const selfiePart: InlinePart = {
      inlineData: {
        mimeType: selfie.slice(5, comma).split(';')[0] || 'image/jpeg',
        data: selfie.slice(comma + 1),
      },
    };
    const garmentPart = await urlToInline(product.imageUrl);

    const instruction =
      'The first image is a photo of a person. The second image shows a garment ' +
      `("${product.name}"). Render the SAME person from the first photo wearing that exact ` +
      'garment — preserve their face, hair, skin tone, body and pose faithfully; replace ' +
      'their upper-body clothing with the garment, fitted naturally with realistic drape ' +
      'and lighting that matches the original photo. Photorealistic.';

    const ai = new GoogleGenAI({ apiKey });
    let lastErr = 'No image returned';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = (await ai.models.generateContent({
          model: MODEL,
          contents: [{ role: 'user', parts: [{ text: instruction }, selfiePart, garmentPart] }],
          config: { responseModalities: [Modality.IMAGE] },
        })) as GenResponse;
        for (const part of res.candidates?.[0]?.content?.parts ?? []) {
          if (part.inlineData?.data) {
            const buffer = Buffer.from(part.inlineData.data, 'base64');
            try {
              const url = await uploadImage(buffer, { folder: 'nanocrew/tryon' });
              return Response.json({ image: url });
            } catch {
              const mime = part.inlineData.mimeType ?? 'image/png';
              return Response.json({ image: `data:${mime};base64,${part.inlineData.data}` });
            }
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
    return Response.json({ error: e instanceof Error ? e.message : 'Try-on failed' }, { status: 502 });
  }
}
