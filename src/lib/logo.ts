import { GoogleGenAI, Modality } from '@google/genai';

import { uploadImage } from '@/lib/cloudinary';
import { borderLooksMagenta, keyOutMagenta, normalizeArt, type ArtShape } from '@/lib/transparency';

// EVE'S LOGO PIPELINE — rebuilt 2026-08-14 after the first kits failed blind review.
// The rules are simple and non-negotiable:
//   A MARK is a symbol that identifies WITHOUT naming — it contains NO text, ever.
//   A WORDMARK is the name AS the design — it contains the name once and NOTHING else.
//   Masters ship flat (solid colors, no gradients/outlines/shadows/textures), tight-cropped,
//   centered. Clear space is a usage rule, not baked pixels.
// Flow per master: generate → magenta-key → normalizeArt (deterministic cleanup/center/crop)
// → one vision acceptance check → at most one retry. Store creation and the Gen Lab harness
// both call this — there is exactly one implementation.

interface InlinePart {
  inlineData?: { data?: string; mimeType?: string };
}
interface GenResponse {
  candidates?: { content?: { parts?: InlinePart[] } }[];
  text?: string;
}

export type LogoStyle = 'wordmark' | 'mark';

/** The interview fields the logo prompts are built from. */
export type LogoBrief = {
  name: string;
  logo: { direction: string };
  designStyle: string;
  designSystem: { palette: { role: string; hex: string }[] };
};

export type LogoMaster = {
  url: string;
  style: LogoStyle;
  shape: ArtShape;
  aspect: number;
};

const MAGENTA_BACKDROP =
  'The background is a SOLID, UNIFORM, PURE MAGENTA (#FF00FF) field filling the frame edge to ' +
  'edge — it is keyed out to transparency, so the artwork itself must contain no magenta or pink. ' +
  'The artwork floats directly on the magenta: no card, panel, frame, or backdrop shape behind it, ' +
  'and no stray marks anywhere else. No watermark.';

const FLAT =
  'FLAT VECTOR STYLE ONLY: solid colors, clean edges. No gradients, no chrome, no bevels, no ' +
  'outlines or sticker halos, no drop shadows, no textures, no paper grain, no 3D.';

function prompts(brief: LogoBrief): Record<LogoStyle, string> {
  const palette = brief.designSystem.palette.map((p) => `${p.role}: ${p.hex}`).join(', ');
  const base = `${FLAT} Use ONLY these brand colors: ${palette}. ${MAGENTA_BACKDROP}`;
  return {
    // The mark identifies WITHOUT naming — text is banned outright.
    mark:
      `A flat vector icon logo for the clothing brand "${brief.name}" — a single simple symbol ` +
      `distilled from: ${brief.logo.direction}. ${brief.designStyle} sensibility. ` +
      'ABSOLUTELY NO TEXT, LETTERS, WORDS, OR NUMBERS anywhere in the image — the symbol alone, ' +
      `centered. Square composition. ${base}`,
    // The wordmark IS the name — nothing else is allowed in the file.
    wordmark:
      `The word "${brief.name}" set as a flat vector wordmark — typography in the spirit of: ` +
      `${brief.logo.direction}. ${brief.designStyle} sensibility. ` +
      `The text "${brief.name}" appears EXACTLY ONCE and is the ONLY thing in the image — no ` +
      'icons, drawings, symbols, taglines, or decorations. One horizontal line of type, centered. ' +
      `Wide composition. ${base}`,
  };
}

/** One cheap vision check per master: does the output obey the rule that defines its type? */
async function accepts(ai: GoogleGenAI, png: Buffer, style: LogoStyle, name: string): Promise<{ ok: boolean; reason: string }> {
  try {
    const question =
      style === 'mark'
        ? 'Does this image contain ANY text, letters, words, or numbers? Answer strict JSON: {"hasText": boolean}'
        : `Does this image show the text "${name}" exactly once, with no other words, no duplicated/overlapping rendering of it, and no pictures or symbols besides the type? Answer strict JSON: {"ok": boolean, "reason": string}`;
    const res = (await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { data: png.toString('base64'), mimeType: 'image/png' } },
            { text: question },
          ],
        },
      ],
      config: { temperature: 0, responseMimeType: 'application/json' },
    })) as GenResponse;
    const raw = res.text ?? '';
    const j = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '')) as { hasText?: boolean; ok?: boolean; reason?: string };
    if (style === 'mark') return { ok: j.hasText !== true, reason: j.hasText ? 'contains text — a mark must be the symbol alone' : '' };
    return { ok: j.ok !== false, reason: j.reason ?? '' };
  } catch {
    return { ok: true, reason: '' }; // the check must never block delivery on its own failure
  }
}

async function generateOnce(ai: GoogleGenAI, prompt: string, aspectRatio: string): Promise<Buffer | null> {
  const res = (await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseModalities: [Modality.IMAGE], imageConfig: { aspectRatio } },
  })) as GenResponse;
  const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  return part?.inlineData?.data ? Buffer.from(part.inlineData.data, 'base64') : null;
}

/** Generate one master. Up to 2 generations total: the retry fires on a failed backdrop OR a
 *  failed acceptance check, with the failure folded into the prompt. Null = both attempts failed. */
export async function generateLogoMaster(
  brief: LogoBrief,
  style: LogoStyle,
  folder = 'nanocrew/logos',
): Promise<LogoMaster | null> {
  try {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    const ai = new GoogleGenAI({ apiKey });
    const prompt = prompts(brief)[style];
    const aspectRatio = style === 'wordmark' ? '16:9' : '1:1';

    let accepted: Buffer | null = null;
    let extra = '';
    for (let attempt = 0; attempt < 2 && !accepted; attempt++) {
      const raw = await generateOnce(ai, prompt + extra, aspectRatio);
      if (!raw) continue;
      if (!borderLooksMagenta(raw)) {
        extra = ' CRITICAL: every border pixel MUST be pure magenta #FF00FF — a non-magenta background is a FAILED generation.';
        continue;
      }
      const keyed = (await keyOutMagenta(raw)) as Buffer;
      const check = await accepts(ai, keyed, style, brief.name);
      if (!check.ok) {
        extra = ` PREVIOUS ATTEMPT FAILED because: ${check.reason}. Fix exactly that.`;
        continue;
      }
      accepted = keyed;
    }
    if (!accepted) return null;

    const art = await normalizeArt(accepted);
    const url = await uploadImage(art.buffer, { folder });
    return { url, style, shape: art.shape, aspect: art.aspect };
  } catch {
    return null; // a store without a logo beats a failed creation
  }
}

/** Legacy single-logo entry (store+api compatibility): the brand's primary asset is the wordmark. */
export async function generateLogo(
  brief: LogoBrief,
  folder = 'nanocrew/logos',
  styleOverride?: LogoStyle,
): Promise<{ url: string; style: LogoStyle } | null> {
  const style = styleOverride ?? 'wordmark';
  const m = await generateLogoMaster(brief, style, folder);
  return m ? { url: m.url, style: m.style } : null;
}
