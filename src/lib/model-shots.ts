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
  candidates?: { content?: { parts?: InlinePart[] } }[];
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

// Angle direction for an on-model PREVIEW, keyed by print placement, so the shot actually reveals
// where the design sits (front print → facing camera, back print → shot from behind, sleeve → side).
const PLACEMENT_ANGLE: Record<string, string> = {
  back: 'The model is photographed from BEHIND so the back of the garment and its print are fully visible.',
  left_sleeve: 'A three-quarter angle from the model’s left so the LEFT SLEEVE print reads clearly.',
  right_sleeve: 'A three-quarter angle from the model’s right so the RIGHT SLEEVE print reads clearly.',
  sleeve: 'A three-quarter side angle so the SLEEVE print reads clearly.',
  hood: 'A slightly-behind angle so the HOOD print is visible.',
  left: 'The model turns to reveal the LEFT side of the garment.',
  right: 'The model turns to reveal the RIGHT side of the garment.',
  front: 'The model faces the camera so the FRONT of the garment and its print are fully visible.',
};
function angleFor(placement: string): string {
  const key = placement.toLowerCase();
  for (const k of Object.keys(PLACEMENT_ANGLE)) if (key.includes(k)) return PLACEMENT_ANGLE[k];
  return PLACEMENT_ANGLE.front;
}
const SCENES = [
  'Clean studio fashion photo, seamless neutral background, soft even lighting.',
  'Candid lifestyle photo, model in a tasteful real-world setting at golden hour, shallow depth of field.',
];

// On-model shots grounded in a REAL Printful mockup — the flat product with the design already
// printed exactly as it will manufacture. Feeding the finished mockup (ONE image) is what keeps
// every shot consistent with Printful reality: given the garment + artwork as separate images,
// Nano Banana reinvents placement/scale per shot (the "logo wanders" bug). One angle-matched shot
// per placement, padded to `minCount` by varying the scene. Hosted on Cloudinary; skips failures.
export async function generateModelShotsFromMockup(
  mockupUrl: string,
  placements: { placement: string; label: string }[],
  minCount = 2,
): Promise<string[]> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_GENAI_API_KEY not configured');
  const ai = new GoogleGenAI({ apiKey });
  const mockup = await urlToInline(mockupUrl);

  const list = placements.length ? placements : [{ placement: 'front', label: 'front' }];
  const specs = list.map((p, i) => ({ ...p, scene: SCENES[i % SCENES.length] }));
  for (let i = specs.length; i < minCount; i++) {
    const base = list[i % list.length];
    specs.push({ ...base, scene: SCENES[i % SCENES.length] });
  }

  const out: string[] = [];
  for (const spec of specs) {
    const prompt =
      `The provided image shows the EXACT product as it will be manufactured, including its printed ` +
      `design. Render a photorealistic, high-resolution fashion photograph of a model wearing/using ` +
      `this exact product. Reproduce the product and its print EXACTLY as shown — same artwork, same ` +
      `position, same size, same colours; do NOT add, move, duplicate or restyle the print. ` +
      `${angleFor(spec.placement)} ${spec.scene} No text or watermark.`;
    try {
      const res = (await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: prompt }, mockup] }],
        config: { responseModalities: [Modality.IMAGE] },
      })) as GenResponse;
      for (const part of res.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data) {
          try {
            out.push(await uploadImage(Buffer.from(part.inlineData.data, 'base64'), { folder: 'nanocrew/preview-shots' }));
          } catch {
            /* hosting failed — skip this shot */
          }
          break;
        }
      }
    } catch {
      /* skip a failed shot; return whatever succeeded */
    }
  }
  return out;
}

// FALLBACK on-model preview (no Printful mockup available): feed the blank garment image (FIRST) +
// the design artwork (SECOND). Placement/scale are the model's guess, so shots may drift from the
// manufactured result — prefer generateModelShotsFromMockup when a mockup can be rendered.
export async function generateDesignOnModelShots(
  garmentImageUrl: string,
  designImageUrl: string,
  placements: { placement: string; label: string }[],
  minCount = 2,
): Promise<string[]> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_GENAI_API_KEY not configured');
  const ai = new GoogleGenAI({ apiKey });
  const [garment, design] = await Promise.all([urlToInline(garmentImageUrl), urlToInline(designImageUrl)]);

  // One shot per placement (angle-matched); pad to minCount by varying the scene of the first placement.
  const list = placements.length ? placements : [{ placement: 'front', label: 'front' }];
  const specs = list.map((p, i) => ({ ...p, scene: SCENES[i % SCENES.length] }));
  for (let i = specs.length; i < minCount; i++) {
    const base = list[i % list.length];
    specs.push({ ...base, scene: SCENES[i % SCENES.length] });
  }

  const out: string[] = [];
  for (const spec of specs) {
    const prompt =
      `Photorealistic, high-resolution fashion photograph. A model wears the garment shown in the ` +
      `FIRST image. The artwork shown in the SECOND image is printed on the ${spec.label} of that ` +
      `garment — keep the artwork’s colours, shapes and details faithful, sized and placed naturally ` +
      `for a ${spec.label} print. ${angleFor(spec.placement)} ${spec.scene} No text, no watermark, and ` +
      `no graphics other than the provided artwork.`;
    try {
      const res = (await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: prompt }, garment, design] }],
        config: { responseModalities: [Modality.IMAGE] },
      })) as GenResponse;
      for (const part of res.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data) {
          try {
            out.push(await uploadImage(Buffer.from(part.inlineData.data, 'base64'), { folder: 'nanocrew/preview-shots' }));
          } catch {
            /* hosting failed — skip this shot */
          }
          break;
        }
      }
    } catch {
      /* skip a failed shot; return whatever succeeded */
    }
  }
  return out;
}
