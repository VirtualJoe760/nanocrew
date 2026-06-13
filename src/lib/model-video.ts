import { generateProductVideo } from '@/lib/veo';
import { uploadVideo } from '@/lib/cloudinary';

// On-model product VIDEO via Veo 3: the video sibling of model-shots.ts. Feed the flat product
// image and render a short clip of a real model wearing the exact garment, for the storefront
// website's on-model gallery + the site's featured video wall. Veo is the priciest call on the
// platform — invoked explicitly, cached on the product row, never per-viewer. Returns the
// hosted Cloudinary URL.

// A few on-model angles to vary the gallery as a creator regenerates (cost-bounded: one clip
// per call). Index by how many videos the product already has so each new clip differs.
const POSES = [
  'a model walking toward camera in a clean studio, full body, soft even lighting, neutral seamless background',
  'a model turning three-quarter in natural daylight, subtle fabric movement, minimal background',
  'a candid lifestyle shot, model strolling through an urban setting at golden hour, shallow depth of field',
];

export async function generateModelVideo(opts: {
  imageUrl: string;
  name: string;
  index?: number; // which pose — defaults to 0
}): Promise<string> {
  const pose = POSES[(opts.index ?? 0) % POSES.length];
  const prompt =
    `Using the provided image as the EXACT garment ("${opts.name}") — keep its print, graphic, ` +
    `colour and cut faithful — render ${pose}. The model wears this garment. Photorealistic, ` +
    `high-resolution fashion film, premium streetwear commercial feel. Vertical format. No text or watermark.`;
  const buffer = await generateProductVideo({ prompt, imageUrl: opts.imageUrl });
  return uploadVideo(buffer, { folder: 'nanocrew/model-videos' });
}
