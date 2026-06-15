import { GoogleGenAI, Modality } from '@google/genai';

import { getUserFromRequest } from '@/lib/auth';
import { uploadImage } from '@/lib/cloudinary';
import { guardRate } from '@/lib/rate-limit';
import { safeImageFetch } from '@/lib/safe-fetch';

// Review-only composite: Nano Banana renders the design ON the garment photo.
// NOT a print file — just for the operator's aesthetic judgment (mirrors
// stephen-lawyer's composeOnGarment). Returns a Cloudinary URL.
const MODEL = 'gemini-2.5-flash-image';

interface InlinePart {
  inlineData?: { data?: string; mimeType?: string };
  text?: string;
}
interface GenResponse {
  candidates?: Array<{ content?: { parts?: InlinePart[] } }>;
}

async function fetchAsInlineData(url: string): Promise<InlinePart> {
  const res = await safeImageFetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image (${res.status})`);
  const mimeType = res.headers.get('content-type') ?? 'image/png';
  const buf = Buffer.from(await res.arrayBuffer());
  return { inlineData: { mimeType, data: buf.toString('base64') } };
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const limited = await guardRate(`gen:${user.id}`, 40, 60);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as {
    designUrl?: string;
    garmentUrl?: string;
    placement?: string;
    garmentName?: string;
  } | null;
  const designUrl = body?.designUrl?.trim();
  const garmentUrl = body?.garmentUrl?.trim();
  if (!designUrl || !garmentUrl) {
    return Response.json({ error: 'designUrl and garmentUrl are required' }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: 'GOOGLE_GENAI_API_KEY not configured' }, { status: 500 });

  const placement = (body?.placement || 'front').replace(/_/g, ' ');
  const garmentName = body?.garmentName || 'garment';
  // Mirror the try-on pipeline's realism: PRESERVE the source garment photo faithfully
  // (so the model/colour/framing don't drift) and print the artwork INTO the fabric so it
  // molds to the cloth — not a flat sticker laid on top.
  const instruction =
    `The first image is the product photo of a "${garmentName}". The second image is a graphic ` +
    'artwork to be printed on it. ' +
    'Keep the product photo EXACTLY as-is: same garment, same fabric colour, same model and pose, ' +
    'same camera framing, crop, background, lighting and aspect ratio. Do not restyle, recolour, ' +
    're-pose or re-crop the garment. ' +
    `Print the graphic onto the ${placement} of the garment as a real direct-to-garment / screen ` +
    'print: the artwork must conform to the fabric — following its drape, folds, wrinkles, seams and ' +
    'the contour of the body underneath — with the weave texture and the garment\'s own shadows and ' +
    'highlights showing subtly through the ink, and its lighting and perspective matched to the photo. ' +
    'A matte printed finish that sits IN the cloth, NOT a flat sticker, decal or label floating on top. ' +
    `Keep the artwork clearly readable, naturally scaled and centered for the ${placement} placement, ` +
    'with no distortion beyond the natural curvature of the cloth. Photorealistic.';

  const ai = new GoogleGenAI({ apiKey });
  try {
    const [garment, design] = await Promise.all([
      fetchAsInlineData(garmentUrl),
      fetchAsInlineData(designUrl),
    ]);

    let lastErr = 'No image returned';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = (await ai.models.generateContent({
          model: MODEL,
          contents: [{ role: 'user', parts: [{ text: instruction }, garment, design] }],
          config: { responseModalities: [Modality.IMAGE] },
        })) as GenResponse;
        for (const part of res.candidates?.[0]?.content?.parts ?? []) {
          if (part.inlineData?.data) {
            const buffer = Buffer.from(part.inlineData.data, 'base64');
            try {
              const url = await uploadImage(buffer, { folder: 'nanocrew/composites' });
              return Response.json({ image: url });
            } catch {
              const mime = part.inlineData.mimeType ?? 'image/png';
              return Response.json({ image: `data:${mime};base64,${part.inlineData.data}` });
            }
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/RESOURCE_EXHAUSTED|quota|\b429\b|PERMISSION_DENIED|UNAUTHENT|\b401\b|\b403\b|NOT_FOUND|\b404\b/i.test(msg)) {
          return Response.json({ error: msg }, { status: 502 });
        }
        lastErr = msg;
      }
    }
    return Response.json({ error: lastErr }, { status: 502 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Composite failed' }, { status: 502 });
  }
}
