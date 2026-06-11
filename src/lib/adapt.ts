import { GoogleGenAI, Modality } from '@google/genai';

import { uploadImage } from '@/lib/cloudinary';

// Fabrication-aware design adaptation: some techniques can't print arbitrary artwork.
// Knitwear is literally knitted from a handful of yarns — gradients, fine detail and
// big palettes don't survive. We regenerate the design to match the constraints and
// carry on with the adapted version (the user is informed in the UI).
const MODEL = 'gemini-2.5-flash-image';

interface InlinePart {
  inlineData?: { data?: string; mimeType?: string };
  text?: string;
}
interface GenResponse {
  candidates?: Array<{ content?: { parts?: InlinePart[] } }>;
}

export async function adaptDesignForKnit(
  designUrl: string,
  yarnHexes: string[],
): Promise<Buffer> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_GENAI_API_KEY not configured');

  const res = await fetch(designUrl);
  if (!res.ok) throw new Error(`Failed to fetch design (${res.status})`);
  const source: InlinePart = {
    inlineData: {
      mimeType: res.headers.get('content-type') ?? 'image/png',
      data: Buffer.from(await res.arrayBuffer()).toString('base64'),
    },
  };

  const palette = yarnHexes.slice(0, 4).join(', ');
  const instruction =
    'Redraw the provided graphic as a KNIT-FRIENDLY version of itself, keeping the same ' +
    `subject and composition. Constraints of jacquard knitting: use ONLY flat solid fills ` +
    `from this yarn palette: ${palette}. No gradients, no shading, no outlines thinner ` +
    'than a few stitches, no tiny details — bold simplified shapes that read clearly when ' +
    'knitted. Place the result centered on a SOLID, UNIFORM, PURE MAGENTA (#FF00FF) ' +
    'background filling the entire frame. The artwork itself must contain NO magenta or pink.';

  const ai = new GoogleGenAI({ apiKey });
  let lastErr = 'No image returned';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const gen = (await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: instruction }, source] }],
        config: { responseModalities: [Modality.IMAGE] },
      })) as GenResponse;
      for (const part of gen.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data) {
          let buffer: Buffer = Buffer.from(part.inlineData.data, 'base64');
          try {
            const { keyOutMagenta } = await import('@/lib/transparency');
            buffer = (await keyOutMagenta(buffer)) as Buffer;
          } catch {
            // ship unkeyed rather than fail
          }
          return buffer;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/RESOURCE_EXHAUSTED|quota|\b429\b|PERMISSION_DENIED|\b40[134]\b/i.test(msg)) throw e;
      lastErr = msg;
    }
  }
  throw new Error(lastErr);
}

export async function hostAdaptedDesign(buffer: Buffer): Promise<string> {
  try {
    return await uploadImage(buffer, { folder: 'nanocrew/designs' });
  } catch {
    return `data:image/png;base64,${buffer.toString('base64')}`;
  }
}
