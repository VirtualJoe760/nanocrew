import { GoogleGenAI, Modality } from '@google/genai';

import { getUserFromRequest } from '@/lib/auth';
import { uploadImage } from '@/lib/cloudinary';
import { guardRate } from '@/lib/rate-limit';
import { TenantError, assertCatalogueOwner } from '@/lib/tenant';

// Nano Banana — Gemini 2.5 Flash Image. Runs server-side only (the key never
// reaches the app bundle). Returns the generated PNG as a base64 data URL.
const MODEL = 'gemini-2.5-flash-image';

// Constraints come AFTER the user's description — leading with "clothing graphic, high
// contrast" steered the model away from faithful subjects (e.g. real likenesses).
function buildConstraints(background: 'transparent' | 'filled', aspectRatio: string): string {
  const base =
    'Depict the subject exactly as described, faithfully. ' +
    'Do not add any text or watermark that was not requested.';
  if (background === 'filled') {
    return (
      `${base} Render it as full-bleed artwork with a complete background filling the ` +
      `entire frame edge to edge at a ${aspectRatio} aspect ratio. No transparency.`
    );
  }
  // The model can't emit true alpha — it FAKES transparency as rendered checkerboard
  // pixels. So we request a solid pure-magenta backdrop and chroma-key it server-side
  // (lib/transparency.ts) into a real transparent PNG.
  return (
    `${base} Render it as artwork for printing on a garment, centered on a SOLID, ` +
    'UNIFORM, PURE MAGENTA (#FF00FF) background filling the entire frame edge to edge. ' +
    'The artwork itself must contain NO magenta or pink hues. Never render a ' +
    'checkerboard pattern. Square (1:1) aspect ratio.'
  );
}

interface InlinePart {
  inlineData?: { data?: string; mimeType?: string };
  text?: string;
}
interface GenResponse {
  candidates?: Array<{ content?: { parts?: InlinePart[] } }>;
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const limited = await guardRate(`gen:${user.id}`, 40, 60);
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as {
    prompt?: string;
    image?: string;
    background?: 'transparent' | 'filled';
    aspectRatio?: string;
    catalogueId?: string;
  } | null;
  const prompt = body?.prompt?.trim();
  const catalogueId = body?.catalogueId;
  const background = body?.background === 'filled' ? 'filled' : 'transparent';
  const aspectRatio = body?.aspectRatio || '1:1';
  const refImage =
    typeof body?.image === 'string' && body.image.startsWith('data:') ? body.image : null;
  if (!prompt && !refImage) {
    return Response.json({ error: 'prompt or image is required' }, { status: 400 });
  }

  // If we'll persist to a catalogue, the creator must own it — check up front.
  let ownedStoreId: string | null = null;
  if (catalogueId) {
    try {
      ownedStoreId = await assertCatalogueOwner(catalogueId, user.id);
    } catch (e) {
      const status = e instanceof TenantError ? e.status : 500;
      return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status });
    }
  }

  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: 'GOOGLE_GENAI_API_KEY not configured' }, { status: 500 });

  const ai = new GoogleGenAI({ apiKey });

  // Instruction text + an optional user-supplied reference image.
  const constraints = buildConstraints(background, aspectRatio);
  const instruction = refImage
    ? `Design: ${prompt || 'a polished version of the reference image'}\n\nUse the provided image as a visual reference. ${constraints}`
    : `Design: ${prompt}\n\n${constraints}`;
  const parts: InlinePart[] = [{ text: instruction }];
  if (refImage) {
    const comma = refImage.indexOf(',');
    const mimeType = refImage.slice(5, comma).split(';')[0] || 'image/png';
    parts.push({ inlineData: { mimeType, data: refImage.slice(comma + 1) } });
  }

  // Nano Banana occasionally returns text/safety with no image — retry a couple times.
  let lastErr = 'No image returned';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = (await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts }],
        config: { responseModalities: [Modality.IMAGE] },
      })) as GenResponse;

      for (const part of res.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data) {
          // Host it on Cloudinary → return a small URL instead of a multi-MB data blob.
          let buffer: Buffer = Buffer.from(part.inlineData.data, 'base64');
          if (background === 'transparent') {
            try {
              const { keyOutMagenta } = await import('@/lib/transparency');
              buffer = (await keyOutMagenta(buffer)) as Buffer;
            } catch {
              // Keying failure shouldn't kill generation — ship the raw image.
            }
          }
          let image: string;
          try {
            image = await uploadImage(buffer, { folder: 'nanocrew/designs' });
          } catch {
            // Cloudinary down → fall back to a data URL (of the keyed buffer).
            image = `data:image/png;base64,${buffer.toString('base64')}`;
          }
          let id: string | undefined;
          if (catalogueId && ownedStoreId) {
            try {
              const { db, schema } = await import('@/lib/db');
              const [row] = await db
                .insert(schema.designs)
                .values({ storeId: ownedStoreId, catalogueId, prompt: prompt || 'Generated design', url: image })
                .returning({ id: schema.designs.id });
              id = row.id;
            } catch {
              // Persistence failure shouldn't kill generation — the image still returns.
            }
          }
          return Response.json({ image, id });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Quota/auth/model errors won't be fixed by retrying.
      if (/RESOURCE_EXHAUSTED|quota|\b429\b|PERMISSION_DENIED|UNAUTHENT|\b401\b|\b403\b|NOT_FOUND|\b404\b/i.test(msg)) {
        return Response.json({ error: msg }, { status: 502 });
      }
      lastErr = msg;
    }
  }
  return Response.json({ error: lastErr }, { status: 502 });
}
