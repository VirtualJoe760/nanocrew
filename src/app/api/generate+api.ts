import { GoogleGenAI, Modality } from '@google/genai';

import { getUserFromRequest } from '@/lib/auth';
import { ContentSafetyError, IMAGE_SAFETY_SETTINGS, assertSafePrompt } from '@/lib/content-safety';
import { CREDIT_COSTS, debit, grant, InsufficientCreditsError } from '@/lib/credits';
import { uploadImage } from '@/lib/cloudinary';
import { guardRate } from '@/lib/rate-limit';
import { MARKED_REGION_RULE, drawMarks, sanitizeMarks } from '@/lib/annotate';
import { getProductTechnique } from '@/lib/printful';
import { safeImageFetch } from '@/lib/safe-fetch';
import { CONSTRAINED_TECHNIQUES, techniqueInfo } from '@/lib/technique';
import { TenantError, assertCatalogueOwner } from '@/lib/tenant';

// Nano Banana — Gemini 2.5 Flash Image. Runs server-side only (the key never
// reaches the app bundle). Returns the generated PNG as a base64 data URL.
const MODEL = 'gemini-2.5-flash-image';

// gemini-2.5-flash-image honors aspect ratio via config.imageConfig.aspectRatio — NOT prompt text
// (the model ignores "...at a 16:9 aspect ratio" and returns ~square). Only these values are accepted
// by the Gemini API; an unsupported value (e.g. the product picker's 4:5) 400s, so we pass it only
// when supported and otherwise omit (model default ~1:1). This is what makes a 16:9 web hero / banner
// actually come out wide instead of square — incl. transparent web assets.
const GEMINI_RATIOS = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9']);

// Constraints come AFTER the user's description — leading with "clothing graphic, high
// contrast" steered the model away from faithful subjects (e.g. real likenesses).
// `technique` (EMBROIDERY / KNITWEAR) appends the fabrication constraint from lib/technique.ts —
// a cap is stitched and a sweater is knitted, so the art must be born producible, not adapted
// after the fact.
function buildConstraints(
  background: 'transparent' | 'filled',
  aspectRatio: string,
  meme = false,
  technique: string | null = null,
): string {
  const fab = techniqueInfo(technique)?.artRule;
  const base =
    'Depict the subject exactly as described, faithfully. ' +
    'Do not add any text or watermark that was not requested — but text that is PART of the ' +
    'requested subject (a flag\'s lettering, a logo\'s name, a slogan) MUST be included, ' +
    'complete and correctly spelled.' +
    (fab ? ` ${fab}` : '');
  if (background === 'filled') {
    return (
      `${base} Render it as full-bleed artwork with a complete background filling the ` +
      `entire frame edge to edge at a ${aspectRatio} aspect ratio. No transparency.`
    );
  }
  // A PRODUCT meme: the WHOLE panel (its photo + captions) is the keep-subject, magenta only outside —
  // so the chroma-key crops to the panel rectangle instead of punching holes inside the meme's photo.
  if (meme) {
    return (
      `${base} The ENTIRE meme panel — its photo/background, captions, everything — is the subject; ` +
      `keep ALL of it. Surround the whole panel with a SOLID, UNIFORM, PURE MAGENTA (#FF00FF) margin ` +
      `filling the rest of the frame at a ${aspectRatio} aspect ratio. The panel itself must contain ` +
      `NO magenta or pink hues; magenta appears ONLY outside the panel — flat, never a checkerboard.`
    );
  }
  // The model can't emit true alpha — it FAKES transparency as rendered checkerboard
  // pixels. So we request a solid pure-magenta backdrop and chroma-key it server-side
  // (lib/transparency.ts) into a real transparent PNG. Honor the requested aspectRatio (and stay
  // context-neutral — not "garment") so TRANSPARENT WEB ASSETS come out web-shaped (hero/banner/
  // logo at 16:9, 1:1, etc.) instead of being forced to a square garment print.
  return (
    `${base} Render the subject centered on a SOLID, UNIFORM, PURE MAGENTA (#FF00FF) background ` +
    `that fills the entire frame edge to edge at a ${aspectRatio} aspect ratio, leaving a clear ` +
    `magenta margin around the subject. The subject must be DIE-CUT style print artwork: no ` +
    `background panel, card, frame or border of its own — magenta must be visible between and ` +
    `around the subject's shapes (e.g. for a flag, render its elements as a graphic composition, ` +
    `not a boxed rectangle). The subject itself must contain NO magenta or pink hues, and the ` +
    `background must be flat magenta — never a checkerboard or gradient.`
  );
}

interface InlinePart {
  inlineData?: { data?: string; mimeType?: string };
  text?: string;
}
interface GenResponse {
  candidates?: { content?: { parts?: InlinePart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

// Nano Banana returns TEXT (not an image) when IT declines a prompt. This is the model provider's
// own limitation, not our policy — we don't police copyright (creators own their designs). But the
// model itself sometimes refuses named characters / brands / real likenesses (RECITATION) or its
// own restricted content (SAFETY/PROHIBITED), so we surface that as an actionable message instead
// of a bare "No image returned" (and don't make it look like a server error).
function refusalMessage(reason?: string, modelText?: string): string {
  const r = reason ?? '';
  if (/RECITATION/i.test(r)) {
    return "The image model wouldn’t render this one — its provider declines some named characters, brands, and real people. Try describing the look in your own words instead.";
  }
  if (/SAFETY|PROHIBITED|IMAGE_SAFETY|BLOCK/i.test(r)) {
    return 'The image model declined this prompt. Try rephrasing or simplifying the wording.';
  }
  const t = (modelText ?? '').trim();
  if (t) return `The image model returned a message instead of an image: ${t.slice(0, 180)}`;
  return 'The image model didn’t return an image — try rephrasing or simplifying the prompt.';
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
    meme?: boolean;
    // The Printful blank this design is destined for (when known — Eve's flow always knows it,
    // the tab's canvas usually doesn't). Non-print techniques (embroidery, knitwear) condition
    // the prompt so the art is born producible (lib/technique.ts).
    templateKey?: number | string;
    // Marker annotations (normalized polylines) — baked as red strokes into the reference so the
    // model can region-target the edit (Joe, 2026-08-18: "circle and edit it with a marker").
    marks?: { x: number; y: number }[][];
  } | null;
  const prompt = body?.prompt?.trim();
  const catalogueId = body?.catalogueId;
  const background = body?.background === 'filled' ? 'filled' : 'transparent';
  const aspectRatio = body?.aspectRatio || '1:1';
  const isMeme = body?.meme === true;
  let refImage = await resolveRef(body?.image);
  if (!prompt && !refImage) {
    return Response.json({ error: 'prompt or image is required' }, { status: 400 });
  }
  // Marker annotations: bake the creator's strokes into the reference image (red brush), and the
  // constraint below tells the model to edit ONLY the marked region and erase the marks.
  const marks = sanitizeMarks(body?.marks);
  let markedRegion = false;
  if (marks && refImage) {
    try {
      const annotated = drawMarks(Buffer.from(refImage.data, 'base64'), marks);
      refImage = { mimeType: 'image/png', data: annotated.toString('base64') };
      markedRegion = true;
    } catch {
      // annotation is best-effort — the un-marked reference still carries the edit
    }
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

  // Technique-aware generation: when the destination blank is known, fetch its primary print
  // technique (cached per product) and condition the prompt for the constrained ones. Best-effort —
  // a Printful blip must never block generation.
  let technique: string | null = null;
  if (body?.templateKey != null && `${body.templateKey}`.trim()) {
    const key = await getProductTechnique(Number(body.templateKey)).catch(() => null);
    if (key && CONSTRAINED_TECHNIQUES.has(key)) technique = key;
  }

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
  const constraints = buildConstraints(background, aspectRatio, isMeme, technique);
  const instruction = refImage
    ? `Design: ${prompt || 'a polished version of the reference image'}\n\nUse the provided image as a visual reference. ${markedRegion ? `${MARKED_REGION_RULE} ` : ''}${constraints}`
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
        config: {
          responseModalities: [Modality.IMAGE],
          safetySettings: IMAGE_SAFETY_SETTINGS,
          ...(GEMINI_RATIOS.has(aspectRatio) ? { imageConfig: { aspectRatio } } : {}),
        },
      })) as GenResponse;

      const cand = res.candidates?.[0];
      for (const part of cand?.content?.parts ?? []) {
        if (part.inlineData?.data) {
          // Host it on Cloudinary → return a small URL instead of a multi-MB data blob.
          let buffer: Buffer = Buffer.from(part.inlineData.data, 'base64');
          if (background === 'transparent') {
            // QUALITY GATE (Joe, 2026-08-17 — the california-flag card): a transparent design must
            // actually BE transparent, die-cut art. A failed key or a subject drawn on its own
            // card used to ship silently; now it's a retry, and a hard refusal at the end.
            let gated = false;
            try {
              const { keyOutMagenta, looksBoxed, featherEdges } = await import('@/lib/transparency');
              let keyed = (await keyOutMagenta(buffer)) as Buffer;
              // FULL-CANVAS art is allowed — it just must not hard-crop at its rectangle: a boxed
              // result gets a default edge FEATHER instead of a refusal (Joe, 2026-08-17, v2 of
              // the die-cut gate — squares are fine when that's what the art is).
              if (!isMeme && looksBoxed(keyed)) {
                try { keyed = featherEdges(keyed); } catch { /* feather is best-effort */ }
              }
              buffer = keyed;
            } catch {
              gated = true; // keying itself failed — never ship a raw magenta tile
              lastErr = 'keying_failed';
            }
            if (gated) continue;
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
                .values({ storeId: ownedStoreId, catalogueId, prompt: prompt || 'Generated design', url: image, technique })
                .returning({ id: schema.designs.id });
              id = row.id;
            } catch {
              // Persistence failure shouldn't kill generation — the image still returns.
            }
          }
          console.log(`[pipeline:generate] ok${technique ? ` technique=${technique}` : ''} prompt=${JSON.stringify((prompt || '').slice(0, 120))} → ${image.slice(0, 60)}…`);
          return Response.json({ image, id, ...(technique ? { technique } : {}) });
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
  if (lastErr === 'keying_failed') {
    return Response.json(
      { error: 'The image backdrop could not be made transparent — try again in a moment.', reason: 'keying_failed' },
      { status: 422 },
    );
  }
  if (sawException) return Response.json({ error: lastErr, reason: 'upstream' }, { status: 502 });
  return Response.json({ error: refusalMessage(undefined, modelText), reason: 'no_image' }, { status: 422 });
}
