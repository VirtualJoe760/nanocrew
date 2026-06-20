import { GoogleGenAI, Modality } from '@google/genai';

import { getUserFromRequest } from '@/lib/auth';
import { ContentSafetyError, IMAGE_SAFETY_SETTINGS, assertSafePrompt } from '@/lib/content-safety';
import { CREDIT_COSTS, debit, grant, InsufficientCreditsError } from '@/lib/credits';
import { uploadImage } from '@/lib/cloudinary';
import { guardRate } from '@/lib/rate-limit';
import { safeImageFetch } from '@/lib/safe-fetch';
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
  candidates?: Array<{ content?: { parts?: InlinePart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
}

// Nano Banana returns TEXT (not an image) when it declines a prompt — usually a copyrighted
// character / brand / real likeness (RECITATION) or restricted content (SAFETY/PROHIBITED). Turn
// that into an actionable message instead of a bare "No image returned" so the creator knows to
// rephrase (and isn't told it's a server error).
function refusalMessage(reason?: string, modelText?: string): string {
  const r = reason ?? '';
  if (/RECITATION/i.test(r)) {
    return "The AI wouldn't generate this — it looks like a copyrighted character, brand, or real person. Try an original subject (avoid named characters/brands/celebrities).";
  }
  if (/SAFETY|PROHIBITED|IMAGE_SAFETY|BLOCK/i.test(r)) {
    return 'The AI declined this prompt under its content policy. Try rephrasing — remove violent, branded, or explicit wording.';
  }
  const t = (modelText ?? '').trim();
  if (t) return `The AI returned a message instead of an image: ${t.slice(0, 180)}`;
  return "The AI didn't return an image — try rephrasing. Named characters, brands, celebrities, and violent wording are often refused.";
}

/**
 * Resolve a reference image to inline base64. Accepts a `data:` URL (used directly) or an
 * already-hosted `https:` URL (fetched SSRF-safely → base64) — the latter lets the canvas/staged
 * graphics, which are hosted Cloudinary URLs, be used as references for "change / add text".
 */
async function resolveRef(image: unknown): Promise<{ mimeType: string; data: string } | null> {
  if (typeof image !== 'string') return null;
  if (image.startsWith('data:')) {
    const comma = image.indexOf(',');
    if (comma < 0) return null;
    return { mimeType: image.slice(5, comma).split(';')[0] || 'image/png', data: image.slice(comma + 1) };
  }
  if (/^https?:\/\//.test(image)) {
    try {
      const res = await safeImageFetch(image);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 10 * 1024 * 1024) return null;
      return { mimeType: res.headers.get('content-type')?.split(';')[0] || 'image/png', data: buf.toString('base64') };
    } catch {
      return null;
    }
  }
  return null;
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
    purpose?: 'logo' | 'design';
  } | null;
  const prompt = body?.prompt?.trim();
  const catalogueId = body?.catalogueId;
  const background = body?.background === 'filled' ? 'filled' : 'transparent';
  const aspectRatio = body?.aspectRatio || '1:1';
  const refImage = await resolveRef(body?.image);
  if (!prompt && !refImage) {
    return Response.json({ error: 'prompt or image is required' }, { status: 400 });
  }

  // Pre-screen only the narrow prohibited set — CSAM, pornographic acts, high-severity gore — before
  // spending credits (Terms §5). Nudity, seductive/edgy, weapons, and action imagery are allowed.
  try {
    assertSafePrompt(prompt);
  } catch (e) {
    if (e instanceof ContentSafetyError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
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

  // Credit-gate creator-initiated generation. Skip the internal first-drop system identity
  // (it generates on the creator's behalf as a free onboarding gift); debit() already no-ops
  // comp accounts. Charge BEFORE the model call, refund on any no-image failure below.
  const charge = user.email !== 'internal@nanocrew';
  const costKey = body?.purpose === 'logo' ? 'logo_generate' : 'design_generate';
  if (charge) {
    try {
      await debit(user.id, costKey, catalogueId);
    } catch (e) {
      if (e instanceof InsufficientCreditsError) {
        return Response.json({ error: 'insufficient_credits', needed: e.needed, balance: e.balance }, { status: 402 });
      }
      throw e;
    }
  }
  const refund = () => {
    if (charge) void grant(user.id, CREDIT_COSTS[costKey], 'refund', catalogueId).catch(() => {});
  };

  const ai = new GoogleGenAI({ apiKey });

  // Instruction text + an optional user-supplied reference image.
  const constraints = buildConstraints(background, aspectRatio);
  const instruction = refImage
    ? `Design: ${prompt || 'a polished version of the reference image'}\n\nUse the provided image as a visual reference. ${constraints}`
    : `Design: ${prompt}\n\n${constraints}`;
  const parts: InlinePart[] = [{ text: instruction }];
  if (refImage) {
    parts.push({ inlineData: { mimeType: refImage.mimeType, data: refImage.data } });
  }

  // Nano Banana occasionally returns text/safety with no image — retry a couple times. A HARD
  // content refusal (copyright/safety) won't change on retry, so we surface it immediately.
  let lastErr = 'No image returned';
  let modelText = ''; // the model's own text when it declines (no image) — used for the message
  let sawException = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = (await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts }],
        config: { responseModalities: [Modality.IMAGE], safetySettings: IMAGE_SAFETY_SETTINGS },
      })) as GenResponse;

      const cand = res.candidates?.[0];
      for (const part of cand?.content?.parts ?? []) {
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
          console.log(`[pipeline:generate] ok prompt=${JSON.stringify((prompt || '').slice(0, 120))} → ${image.slice(0, 60)}…`);
          return Response.json({ image, id });
        }
      }

      // No image in this attempt — figure out WHY (Gemini puts the reason in finishReason /
      // promptFeedback / a text part). A hard content refusal won't change on retry → return now.
      const finish = cand?.finishReason;
      const blockReason = res.promptFeedback?.blockReason;
      const text = (cand?.content?.parts ?? []).map((p) => p.text).filter(Boolean).join(' ').trim();
      if (text) modelText = text;
      if ((finish && /SAFETY|PROHIBITED|RECITATION|IMAGE_SAFETY|BLOCK/i.test(finish)) || blockReason) {
        refund();
        console.log(`[pipeline:generate] refused finish=${finish ?? ''} block=${blockReason ?? ''}`);
        return Response.json({ error: refusalMessage(finish ?? blockReason, text), reason: finish ?? blockReason }, { status: 422 });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Quota/auth/model errors won't be fixed by retrying.
      if (/RESOURCE_EXHAUSTED|quota|\b429\b|PERMISSION_DENIED|UNAUTHENT|\b401\b|\b403\b|NOT_FOUND|\b404\b/i.test(msg)) {
        refund();
        return Response.json({ error: msg }, { status: 502 });
      }
      sawException = true;
      lastErr = msg;
    }
  }
  refund();
  // Exhausted retries. A genuine upstream/exception → 502; otherwise the model just kept declining
  // to return an image (no hard-refusal flag) → 422 with an actionable message, not a scary gateway error.
  if (sawException) return Response.json({ error: lastErr }, { status: 502 });
  return Response.json({ error: refusalMessage(undefined, modelText), reason: 'no_image' }, { status: 422 });
}
