import { GoogleGenAI, Modality } from '@google/genai';

import { uploadImage } from '@/lib/cloudinary';

// EVE'S LOGO PIPELINE — extracted verbatim from store+api.ts so the Gen Lab dev harness
// (/api/dev/logo) exercises EXACTLY the code store creation runs: same prompt assembly, same
// backdrop-validation retry, same chroma-key, same upload. Store creation still calls this.

interface InlinePart {
  inlineData?: { data?: string; mimeType?: string };
}
interface GenResponse {
  candidates?: { content?: { parts?: InlinePart[] } }[];
}

/** Wordmark-style directions want a WIDE canvas; icon marks stay square. Written into the brand
 *  contract as `logoStyle` so templates know whether the logo already carries the name (a wordmark
 *  next to a text name = the name twice — bad navbar design). */
export type LogoStyle = 'wordmark' | 'mark';
export function classifyLogoStyle(direction: string): LogoStyle {
  return /wordmark|word mark|lettermark|typograph|type-based|name in|brand name as/i.test(direction)
    ? 'wordmark'
    : 'mark';
}

/** The interview fields the logo prompt is built from — the subset of BrandResult it reads. */
export type LogoBrief = {
  name: string;
  logo: { direction: string };
  designStyle: string;
  designSystem: { palette: { role: string; hex: string }[] };
};

/** Generate a logo mark from the interview's direction, honoring the stated palette. Logos default
 *  to a TRANSPARENT background — a mark gets composited onto the site header, OG card, app chrome,
 *  etc., so a solid box would look wrong. Nano Banana can't emit alpha, so (like /api/generate's
 *  transparent path) we prompt for a pure-magenta backdrop and chroma-key it out (lib/transparency). */
export async function generateLogo(
  brand: LogoBrief,
  folder = 'nanocrew/logos',
): Promise<{ url: string; style: LogoStyle } | null> {
  try {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    const ai = new GoogleGenAI({ apiKey });
    const palette = brand.designSystem.palette.map((p) => `${p.role}: ${p.hex}`).join(', ');
    // Wordmarks are WIDE artifacts (navbar lockups) — a square canvas shrinks the name to a strip.
    // imageConfig.aspectRatio is what the model honors (prompt text is ignored for AR).
    const style = classifyLogoStyle(brand.logo.direction);
    const aspectRatio = style === 'wordmark' ? '16:9' : '1:1';
    const prompt =
      `Logo for the clothing brand "${brand.name}". ${brand.logo.direction}. ` +
      `${brand.designStyle} design style. THE MARK ITSELF uses ONLY these brand colors: ${palette} — ` +
      'and must contain NO magenta or pink hues. ' +
      'THE BACKGROUND is separate from the mark and is NOT one of the brand colors: fill it edge to edge ' +
      'with SOLID, UNIFORM, PURE MAGENTA (#FF00FF) — even if the brand palette is dark, the backdrop is ' +
      'ALWAYS magenta (it is keyed out to a transparent PNG). Never render a checkerboard pattern. ' +
      'If the direction calls for text, render the brand name EXACTLY ONCE, spelled precisely, ' +
      'and no other text. The mark must be clearly legible against the brand background color. ' +
      'No border or frame around the canvas. No watermark.';
    const generate = async (text: string): Promise<Buffer | null> => {
      const res = (await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [{ role: 'user', parts: [{ text }] }],
        config: { responseModalities: [Modality.IMAGE], imageConfig: { aspectRatio } },
      })) as GenResponse;
      const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      return part?.inlineData?.data ? Buffer.from(part.inlineData.data, 'base64') : null;
    };
    let buffer = await generate(prompt);
    if (!buffer) return null;
    try {
      const { borderLooksMagenta, keyOutMagenta } = await import('@/lib/transparency');
      // VALIDATION GATE (recurring bug B5): dark-palette brands kept getting non-magenta backdrops,
      // the key no-oped, and an opaque tile shipped as the brand's face. One retry with the magenta
      // demand escalated; if the model still refuses, ship the filled mark as before (never fail
      // store creation over a logo).
      if (!borderLooksMagenta(buffer)) {
        console.warn('[store:logo] backdrop not magenta — retrying once with escalated directive');
        const retry = await generate(
          `${prompt} CRITICAL, HIGHEST PRIORITY: every border pixel of the image MUST be pure magenta ` +
            '#FF00FF. A non-magenta background is a FAILED generation.',
        );
        if (retry && borderLooksMagenta(retry)) buffer = retry;
      }
      // Key the magenta backdrop out to real alpha. keyOutMagenta is a no-op if the border isn't
      // actually magenta (model ignored the instruction) → we ship the filled mark rather than fail.
      buffer = (await keyOutMagenta(buffer)) as Buffer;
    } catch {
      // Keying failure shouldn't kill brand creation — ship the raw image.
    }
    const url = await uploadImage(buffer, { folder });
    return { url, style };
  } catch {
    return null; // a store without a logo beats a failed creation
  }
}
