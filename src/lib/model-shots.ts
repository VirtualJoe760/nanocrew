import { GoogleGenAI, Modality } from '@google/genai';

import { uploadImage } from '@/lib/cloudinary';

// On-model product photography via Nano Banana: feed the flat product image and render the
// exact product worn (or carried/used — bags, hats, accessories) by a model in a few poses,
// for the product-page gallery. Photoreal, graphic-faithful. Hosted on Cloudinary; returns
// the URLs (skips poses that fail).
const MODEL = 'gemini-2.5-flash-image';

// Every shot is PORTRAIT (3:4) — the shape product cards and strips are built around. Passed via
// config.imageConfig (prompt-text ratios are ignored by the model, same as /api/generate).
const SHOT_RATIO = '3:4';
// Framing contract appended to every prompt: these shots sell the product AND the person — a crop
// that loses the face reads like a mannequin. Head-to-mid-thigh keeps both readable at card size.
const FRAMING =
  'Portrait orientation. In posed shots, frame from just above the head to mid-thigh; in action ' +
  'shots full body is fine — but the model’s face and the product must BOTH be clearly visible.';

// PRINT REALISM (Joe, 2026-08-17): shots were reading as "a picture stuck on an actor" — sharp
// sticker edges, no fabric interaction. This contract rides every prompt: the artwork must behave
// like ink in cloth, not an overlay.
const PRINT_REALISM =
  'The graphic is SCREEN-PRINTED INTO the fabric: the ink follows every fold, wrinkle, stretch ' +
  'and drape of the garment; it curves with the body, breaks slightly over seams, and carries ' +
  'the fabric’s weave texture through it. Matte ink, softly integrated edges — NEVER a sharp, ' +
  'glossy, perfectly-flat sticker or digital overlay. Scene lighting and shadows fall across the ' +
  'print exactly as they fall across the cloth around it.';

// ACTION-FIRST (Joe, 2026-08-20: "modeling shots should be action shots — walking in the park,
// at a coffee shop"). Real-environment candids lead the bank; one clean studio look survives as
// the anchor so a set still carries a catalog-grade reference frame.
const POSES = [
  'an action photo, model walking through a leafy park, mid-stride, natural light, print clearly readable',
  'a candid photo, model at a coffee shop — stepping out with a cup or laughing at an outdoor table, print clearly readable',
  'an action photo, model mid-stride crossing a city street, motion in the scene, print clearly readable',
  'an action photo, model skateboarding or leaning off a rail in a skatepark at dusk, dynamic angle',
  'an outdoor action photo, model jogging or stretching on a coastal trail in morning light',
  'a clean studio fashion photo, model facing forward, neutral seamless background, soft even lighting',
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

/** @deprecated 2026-08-20 — both callers (publish auto-shots, /api/creator/model-shots) moved to
 *  the placement-aware `generateModelShotsFromMockup`, which angle-matches the print's placement
 *  (a back print is shot from behind). This pose-bank generator shoots front-ish regardless. */
export async function generateModelShots(productImageUrl: string, count = 3): Promise<string[]> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_GENAI_API_KEY not configured');
  const ai = new GoogleGenAI({ apiKey });
  const product = await urlToInline(productImageUrl);

  const out: string[] = [];
  for (let i = 0; i < Math.min(count, POSES.length); i++) {
    const prompt =
      `Using the provided image as the EXACT product (keep its print, graphic, colour and ` +
      `shape faithful), render ${POSES[i]}. The model wears, carries or uses this product as ` +
      `appropriate for its type (worn if apparel, carried or in use if a bag or accessory). ` +
      `${PRINT_REALISM} ${FRAMING} Photorealistic, high-resolution fashion photography. ` +
      `No text or watermark.`;
    try {
      const res = (await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: prompt }, product] }],
        config: { responseModalities: [Modality.IMAGE], imageConfig: { aspectRatio: SHOT_RATIO } },
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
  back: 'The model is photographed from BEHIND so the back of the product and its print are fully visible.',
  left_sleeve: 'A three-quarter angle from the model’s left so the LEFT SLEEVE print reads clearly.',
  right_sleeve: 'A three-quarter angle from the model’s right so the RIGHT SLEEVE print reads clearly.',
  sleeve: 'A three-quarter side angle so the SLEEVE print reads clearly.',
  hood: 'A slightly-behind angle so the HOOD print is visible.',
  left: 'The model turns to reveal the LEFT side of the product.',
  right: 'The model turns to reveal the RIGHT side of the product.',
  front: 'The model faces the camera so the FRONT of the product and its print are fully visible.',
};
function angleFor(placement: string): string {
  const key = placement.toLowerCase();
  for (const k of Object.keys(PLACEMENT_ANGLE)) if (key.includes(k)) return PLACEMENT_ANGLE[k];
  return PLACEMENT_ANGLE.front;
}
// Action-first here too (Joe, 2026-08-20) — the studio look stays as one anchor frame. Four
// scenes, not two: the publish path pads to 6 shots by rotating this bank, so more variety here
// is directly more variety in every product gallery.
const SCENES = [
  'Action photo, model walking through a leafy park, mid-stride, natural light, print clearly readable.',
  'Candid photo, model at a coffee shop — stepping out with a cup or at an outdoor table, print clearly readable.',
  'Action photo, model mid-stride crossing a city street, motion in the scene, print clearly readable.',
  'Clean studio fashion photo, seamless neutral background, soft even lighting.',
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
      `design. Render a photorealistic, high-resolution fashion photograph of a model wearing, ` +
      `carrying or using this exact product as appropriate for its type (worn if apparel, carried ` +
      `or in use if a bag or accessory). Reproduce the product and its print EXACTLY as shown — same artwork, same ` +
      `position, same size, same colours; do NOT add, move, duplicate or restyle the print. ` +
      `${PRINT_REALISM} ${angleFor(spec.placement)} ${spec.scene} ${FRAMING} No text or watermark.`;
    try {
      const res = (await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: prompt }, mockup] }],
        config: { responseModalities: [Modality.IMAGE], imageConfig: { aspectRatio: SHOT_RATIO } },
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

// FALLBACK on-model preview (no Printful mockup available): feed the blank product image (FIRST) +
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
      `Photorealistic, high-resolution fashion photograph. A model wears, carries or uses the product ` +
      `shown in the FIRST image, as appropriate for its type (worn if apparel, carried or in use if a ` +
      `bag or accessory). The artwork shown in the SECOND image is printed on the ${spec.label} of that ` +
      `product — keep the artwork’s colours, shapes and details faithful, sized and placed naturally ` +
      `for a ${spec.label} print. ${PRINT_REALISM} ${angleFor(spec.placement)} ${spec.scene} ${FRAMING} ` +
      `No text, no watermark, and no graphics other than the provided artwork.`;
    try {
      const res = (await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: prompt }, garment, design] }],
        config: { responseModalities: [Modality.IMAGE], imageConfig: { aspectRatio: SHOT_RATIO } },
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
