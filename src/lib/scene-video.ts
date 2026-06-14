import { GoogleGenAI, Modality } from '@google/genai';

import { uploadImage, uploadVideo } from '@/lib/cloudinary';
import { generateFalVideo, type SceneAspect, type VideoModelKey } from '@/lib/fal-video';

// The "cool short" pipeline: Nano Banana first renders a photoreal on-model image of someone
// WEARING the exact garment in a scene, then a fal video model animates that image into a video
// of the model actually doing the thing. Two steps so the person + garment stay faithful before motion.

const NB_MODEL = 'gemini-2.5-flash-image';

// Scene presets the creator can pick (or pass a freeform one).
export const SCENES = [
  'skateboarding down a sunlit city street',
  'walking along a beach at golden hour',
  'crossing a busy downtown intersection',
  'riding up in a glass elevator',
  'on an airplane by the window',
  'dancing in a neon-lit club',
  'leaning against a cocktail bar',
] as const;

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

/** Step 1 — Nano Banana: a photoreal on-model scene image at the chosen aspect ratio. */
async function sceneImage(productImageUrl: string, name: string, scene: string, aspect: SceneAspect): Promise<string> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_GENAI_API_KEY not configured');
  const ai = new GoogleGenAI({ apiKey });
  const product = await urlToInline(productImageUrl);
  const orient = aspect === '9:16' ? 'vertical 9:16 portrait' : 'horizontal 16:9 landscape';
  const prompt =
    `Using the provided image as the EXACT garment ("${name}") — keep its print, graphic, colour and ` +
    `cut perfectly faithful — render a photorealistic ${orient} photo of a real person WEARING this ` +
    `garment, ${scene}. Cinematic, natural light, premium streetwear commercial feel. No text or watermark.`;
  const res = (await ai.models.generateContent({
    model: NB_MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }, product] }],
    config: { responseModalities: [Modality.IMAGE] },
  })) as GenResponse;
  for (const part of res.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) {
      // Host the still so the video model (and a UI preview) can reference it by URL.
      return uploadImage(Buffer.from(part.inlineData.data, 'base64'), { folder: 'nanocrew/scene-stills' });
    }
  }
  throw new Error('no scene image generated');
}

/** Full pipeline → returns { stillUrl, videoUrl } (both hosted on Cloudinary). */
export async function generateProductSceneVideo(opts: {
  imageUrl: string;
  name: string;
  scene: string;
  aspectRatio: SceneAspect;
  modelKey?: VideoModelKey;
}): Promise<{ stillUrl: string; videoUrl: string }> {
  const stillUrl = await sceneImage(opts.imageUrl, opts.name, opts.scene, opts.aspectRatio);
  const buffer = await generateFalVideo({
    imageUrl: stillUrl,
    prompt: `The person is ${opts.scene}. Natural, fluid movement; subtle camera motion; cinematic.`,
    aspectRatio: opts.aspectRatio,
    modelKey: opts.modelKey,
  });
  const videoUrl = await uploadVideo(buffer, { folder: 'nanocrew/scene-videos' });
  return { stillUrl, videoUrl };
}
