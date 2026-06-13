import { GoogleGenAI, Modality } from '@google/genai';

import { uploadImage } from '@/lib/cloudinary';

// On-model product photography via Nano Banana: feed the flat product image and render the
// exact garment worn by a model in a few poses, for the product-page gallery. Photoreal,
// graphic-faithful. Hosted on Cloudinary; returns the URLs (skips poses that fail).
const MODEL = 'gemini-2.5-flash-image';

const POSES = [
  'a clean full-body studio fashion photo, model facing forward, neutral seamless background, soft even lighting',
  'a three-quarter editorial photo, model turned slightly, natural daylight, minimal background',
  'a candid lifestyle photo, model in an urban setting at golden hour, shallow depth of field',
];

interface InlinePart {
  inlineData?: { data?: string; mimeType?: string };
  text?: string;
}
interface GenResponse {
  candidates?: Array<{ content?: { parts?: InlinePart[] } }>;
}

async function urlToInline(url: string): Promise<InlinePart> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch product image (${res.status})`);
  return {
    inlineData: {
      mimeType: res.headers.get('content-type') ?? 'image/png',
      data: Buffer.from(await res.arrayBuffer()).toString('base64'),
    },
  };
}

export async function generateModelShots(productImageUrl: string, count = 3): Promise<string[]> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_GENAI_API_KEY not configured');
  const ai = new GoogleGenAI({ apiKey });
  const product = await urlToInline(productImageUrl);

  const out: string[] = [];
  for (let i = 0; i < Math.min(count, POSES.length); i++) {
    const prompt =
      `Using the provided image as the EXACT garment (keep its print, graphic, colour and ` +
      `cut faithful), render ${POSES[i]}. The model wears this garment. Photorealistic, ` +
      `high-resolution fashion photography. No text or watermark.`;
    try {
      const res = (await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: prompt }, product] }],
        config: { responseModalities: [Modality.IMAGE] },
      })) as GenResponse;
      for (const part of res.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data) {
          try {
            out.push(await uploadImage(Buffer.from(part.inlineData.data, 'base64'), { folder: 'nanocrew/model-shots' }));
          } catch {
            /* hosting failed — skip this shot */
          }
          break;
        }
      }
    } catch {
      /* skip a failed pose; return whatever succeeded */
    }
  }
  return out;
}
