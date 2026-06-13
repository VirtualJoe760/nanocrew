import { GoogleGenAI, Modality } from '@google/genai';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { uploadImage } from '@/lib/cloudinary';
import { provisionStorefront } from '@/lib/provision';
import { buildOgImageUrl } from '@/lib/og-image';
import { canLaunchStore } from '@/lib/billing';
import { autoFirstDropEnabled, generateFirstDrop } from '@/lib/first-drop';
import type { BrandResult, ChatMessage } from '@/lib/interview';

// POST /api/store — persist a finished Studio interview as the creator's store:
// brand identity → stores.brand_profile, design language → stores.design_system, and a
// generated logo (from the interview's logo direction + palette) → stores.logo_url.

interface InlinePart {
  inlineData?: { data?: string; mimeType?: string };
}
interface GenResponse {
  candidates?: Array<{ content?: { parts?: InlinePart[] } }>;
}

/** Generate a logo mark from the interview's direction, honoring the stated palette. */
async function generateLogo(brand: BrandResult): Promise<string | null> {
  try {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    const ai = new GoogleGenAI({ apiKey });
    const palette = brand.designSystem.palette.map((p) => `${p.role}: ${p.hex}`).join(', ');
    const prompt =
      `Logo for the clothing brand "${brand.name}". ${brand.logo.direction}. ` +
      `${brand.designStyle} design style. Use ONLY these brand colors: ${palette}. ` +
      'A clean, iconic mark centered on a plain solid background matching the brand ' +
      'background color. Square 1:1. No text other than the brand name, and only if the ' +
      'description asks for it. No watermark.';
    const res = (await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseModalities: [Modality.IMAGE] },
    })) as GenResponse;
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) return null;
    return await uploadImage(Buffer.from(part.inlineData.data, 'base64'), {
      folder: 'nanocrew/logos',
    });
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
            status: 'building',
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
        void provisionStorefront({
          storeId: store.id,
          slug: store.slug,
          brand,
          logoUrl,
          transcript,
        });
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
