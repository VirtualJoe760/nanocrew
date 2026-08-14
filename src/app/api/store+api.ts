import { GoogleGenAI, Modality } from '@google/genai';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { uploadImage } from '@/lib/cloudinary';
import { provisionStorefront } from '@/lib/provision';
import { buildOgImageUrl } from '@/lib/og-image';
import { canLaunchStore } from '@/lib/billing';
import { ensureConnectedAccount } from '@/lib/connect';
import { autoFirstDropEnabled, generateFirstDrop } from '@/lib/first-drop';
import type { BrandResult, ChatMessage } from '@/lib/interview';

// POST /api/store — persist a finished Studio interview as the creator's store:
// brand identity → stores.brand_profile, design language → stores.design_system, and a
// generated logo (from the interview's logo direction + palette) → stores.logo_url.

interface InlinePart {
  inlineData?: { data?: string; mimeType?: string };
}
interface GenResponse {
  candidates?: { content?: { parts?: InlinePart[] } }[];
}

/** Generate a logo mark from the interview's direction, honoring the stated palette. Logos default
 *  to a TRANSPARENT background — a mark gets composited onto the site header, OG card, app chrome,
 *  etc., so a solid box would look wrong. Nano Banana can't emit alpha, so (like /api/generate's
 *  transparent path) we prompt for a pure-magenta backdrop and chroma-key it out (lib/transparency). */
async function generateLogo(brand: BrandResult): Promise<string | null> {
  try {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    const ai = new GoogleGenAI({ apiKey });
    const palette = brand.designSystem.palette.map((p) => `${p.role}: ${p.hex}`).join(', ');
    const prompt =
      `Logo for the clothing brand "${brand.name}". ${brand.logo.direction}. ` +
      `${brand.designStyle} design style. THE MARK ITSELF uses ONLY these brand colors: ${palette} — ` +
      'and must contain NO magenta or pink hues. ' +
      'THE BACKGROUND is separate from the mark and is NOT one of the brand colors: fill it edge to edge ' +
      'with SOLID, UNIFORM, PURE MAGENTA (#FF00FF) — even if the brand palette is dark, the backdrop is ' +
      'ALWAYS magenta (it is keyed out to a transparent PNG). Never render a checkerboard pattern. ' +
      'Square 1:1. If the direction calls for text, render the brand name EXACTLY ONCE, spelled precisely, ' +
      'and no other text. No border or frame around the canvas. No watermark.';
    const res = (await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseModalities: [Modality.IMAGE] },
    })) as GenResponse;
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) return null;
    let buffer: Buffer = Buffer.from(part.inlineData.data, 'base64');
    try {
      // Key the magenta backdrop out to real alpha. keyOutMagenta is a no-op if the border isn't
      // actually magenta (model ignored the instruction) → we ship the filled mark rather than fail.
      const { keyOutMagenta } = await import('@/lib/transparency');
      buffer = (await keyOutMagenta(buffer)) as Buffer;
    } catch {
      // Keying failure shouldn't kill brand creation — ship the raw image.
    }
    return await uploadImage(buffer, { folder: 'nanocrew/logos' });
  } catch {
    return null; // a store without a logo beats a failed creation
  }
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let brand: BrandResult;
  let transcript: ChatMessage[] = [];
  try {
    const body = (await req.json()) as { brand?: BrandResult; transcript?: ChatMessage[] };
    if (!body.brand?.name) throw new Error();
    brand = body.brand;
    transcript = (body.transcript ?? []).slice(0, 80);
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }

  try {
    // Make sure the creators row exists (same bootstrap /api/me does). Conflict-ignore
    // without a target: an email collision (e.g. seeded data) must not explode here.
    await db
      .insert(schema.creators)
      .values({ id: user.id, email: user.email })
      .onConflictDoNothing();

    // Launching a store requires an active paid plan with room under its brand cap. Free
    // accounts can browse and shop, but not sell — the client shows the paywall on 402.
    const gate = await canLaunchStore(user.id);
    if (!gate.ok) {
      return Response.json(
        {
          error: gate.reason,
          plan: gate.entitlements.plan,
          maxBrands: gate.entitlements.maxBrands,
          brandCount: gate.brandCount,
        },
        { status: 402 },
      );
    }

    // A website (Vercel storefront + domain) is a Pro+ feature. Starter brands sell in the app
    // (feed / Market / in-app store) with no site, so we skip provisioning for them.
    const website = gate.entitlements.website;

    const base =
      brand.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'store';

    const { designSystem, ...profile } = brand;
    const logoUrl = await generateLogo(brand);
    // The brand's OG / share card AND its avatar in-app — logo + tagline on the brand bg.
    // Built whether or not a website ever ships, so a shop-only brand still has a clean visual.
    const ogImageUrl = buildOgImageUrl({
      logoUrl,
      tagline: brand.tagline,
      bgHex: designSystem.palette.find((p) => p.role.toLowerCase().includes('background'))?.hex,
      textHex: designSystem.palette.find((p) => p.role.toLowerCase().includes('text'))?.hex,
    });

    // Retry on slug collision with a numeric suffix.
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
      try {
        const [store] = await db
          .insert(schema.stores)
          .values({
            creatorId: user.id,
            name: brand.name,
            slug,
            tagline: brand.tagline,
            descriptionMd: brand.story,
            // The raw interview is brand data too — the template engine and future
            // revisions mine what the creator actually said.
            brandProfile: { ...profile, transcript },
            designSystem,
            logoUrl,
            ogImageUrl,
            // Website plans build a site (building → ready); app-only brands are ready at once.
            status: website ? 'building' : 'ready',
          })
          .returning({ id: schema.stores.id, slug: schema.stores.slug, logoUrl: schema.stores.logoUrl });
        // A fresh store needs a first catalogue so the Designer has somewhere to work —
        // named after what they said they're most excited to sell.
        const firstProduct = brand.products?.[0]?.trim();
        await db.insert(schema.catalogues).values({
          storeId: store.id,
          name: firstProduct ? `First drop — ${firstProduct}` : 'First drop',
          slug: 'first-drop',
        });
        // Storefront engine: clone the template into a per-brand repo and let a Claude
        // session on the VPS apply the brand. Fire-and-forget — creation never waits.
        // Pro+ only; a Starter brand sells in-app and can add a site later by upgrading.
        if (website) {
          void provisionStorefront({
            storeId: store.id,
            slug: store.slug,
            brand,
            logoUrl,
            transcript,
          });
        }
        // Born connecting (Phase D): start the creator's Stripe Connect account so their brand can
        // take its own money. Best-effort — if Connect isn't enabled yet this no-ops and the
        // creator finishes onboarding later from the app; store creation never fails on it.
        void ensureConnectedAccount(user.id, user.email).catch(() => {});
        // Auto-generate a first product drop so the brand isn't empty — gated behind
        // AUTO_FIRST_DROP because each run spends real Gemini + Printful credits.
        if (autoFirstDropEnabled()) {
          void generateFirstDrop({ storeId: store.id, baseUrl: new URL(req.url).origin });
        }
        return Response.json({ store });
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        if (!/unique|duplicate/i.test(msg)) throw e;
      }
    }
    throw new Error('could not find a free store slug');
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
