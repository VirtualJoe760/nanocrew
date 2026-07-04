import { GoogleGenAI, Modality } from '@google/genai';

import { uploadImage } from '@/lib/cloudinary';
import type { BrandResult } from '@/lib/interview';

// Provision-time HERO IMAGE — the blank-hero killer (docs/studio/FORGE_DIVERSITY.md, track 2).
// One art-directed Nano Banana render from the brand's own interview data (vibe, palette, story,
// products), hosted on Cloudinary and written to stores.site_assets.hero.imageUrl — the live-read
// slot every template's hero block already prefers over placeholders (templates _shared/lib/api.ts
// getHeroMedia). Zero template or forge changes needed; the creator replaces it any time from the
// Design tab ("Set as website hero").
const MODEL = 'gemini-2.5-flash-image';

interface InlinePart {
  inlineData?: { data?: string; mimeType?: string };
  text?: string;
}
interface GenResponse {
  candidates?: { content?: { parts?: InlinePart[] } }[];
}

const STYLE_MOOD: Record<BrandResult['designStyle'], string> = {
  minimalist: 'clean negative space, one strong subject, soft even light, gallery calm',
  bold: 'high contrast, dramatic light, strong diagonals, unapologetic energy',
  elegant: 'soft editorial light, refined textures, quiet luxury, shallow depth of field',
  extravagant: 'saturated color, theatrical lighting, opulent surfaces, maximal atmosphere',
  street: 'urban texture, golden-hour concrete, candid motion, gritty film grain',
};

/** Build the hero art-direction prompt from the brand's own words. NO text in the image —
 *  the headline/CTA render as live HTML on top, so lettering would double up. */
function heroPrompt(brand: BrandResult): string {
  const palette = brand.designSystem.palette.map((p) => `${p.role} ${p.hex}`).join(', ');
  const vibe = brand.vibeKeywords.join(', ');
  const products = brand.products.slice(0, 3).join(', ');
  return (
    `A cinematic website hero photograph for "${brand.name}" — ${brand.tagline}. ` +
    `Brand vibe: ${vibe}. The world of this brand: ${brand.story.slice(0, 240)} ` +
    `Evoke the products (${products}) through scene and atmosphere — environment, texture, ` +
    `and light, not a product catalog shot. Mood: ${STYLE_MOOD[brand.designStyle]}. ` +
    `Color-grade the scene toward the brand palette (${palette}). Wide composition with clear ` +
    `negative space for a headline overlay. Photorealistic, high resolution. ` +
    `ABSOLUTELY NO text, letters, logos, or watermarks anywhere in the image.`
  );
}

/** Generate + host the brand's provision-time hero. Returns the hosted URL, or null on any
 *  failure — the caller treats this as best-effort (the template's brand-tinted fallback stays). */
export async function generateHeroImage(brand: BrandResult): Promise<string | null> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const ai = new GoogleGenAI({ apiKey });
  try {
    const res = (await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: heroPrompt(brand) }] }],
      config: { responseModalities: [Modality.IMAGE], imageConfig: { aspectRatio: '16:9' } },
    })) as GenResponse;
    for (const part of res.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data) {
        return await uploadImage(Buffer.from(part.inlineData.data, 'base64'), { folder: 'nanocrew/heroes' });
      }
    }
  } catch (e) {
    // Best-effort — provision continues with the template's brand-tinted hero treatment, but the
    // reason belongs in the provision logs (a silent null here looks like "no hero for no reason").
    console.warn(`[hero-image] ${brand.name}: ${e instanceof Error ? e.message : e}`);
  }
  return null;
}
