import { eq, inArray } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { guardRate } from '@/lib/rate-limit';
import { isStoreMember } from '@/lib/tenant';
import { CREDIT_COSTS, debit, grant, InsufficientCreditsError } from '@/lib/credits';
import { generateDesignOnModelShots, generateModelShotsFromMockup } from '@/lib/model-shots';
import { getCatalogVariants, getProductMeta, renderMockups, type MockupFile } from '@/lib/printful';

// POST /api/creator/preview-shots { designId, templateKey, garmentUrl, placements? } — render
// on-model PREVIEW photos at the placement step, BEFORE the design is committed (no composition
// row yet). Ground truth first: render the REAL Printful mockup (design printed exactly as it
// will manufacture — auto-fit position, the same default doCombine uses), then have Nano Banana
// put that finished product on a model. That keeps every shot consistent with each other AND
// with Printful. If the mockup task fails, fall back to the garment+design two-image path.
// Credit-gated (debit-then-refund). Nothing persisted — the client caches per session.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const limited = await guardRate(`pf:${user.id}`, 60, 60); // shares Printful's rate bucket with /api/mockup
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as {
    designId?: string;
    templateKey?: string;
    garmentUrl?: string;
    // Optional per-placement designId (multi-design composites — front logo + back art); defaults
    // to the primary designId. Same shape /api/mockup consumes.
    placements?: { placement: string; label: string; designId?: string }[];
  } | null;
  if (!body?.designId || (!body.templateKey && !body.garmentUrl)) {
    return Response.json({ error: 'designId and templateKey (or garmentUrl) required' }, { status: 400 });
  }

  const [design] = await db
    .select({ id: schema.designs.id, url: schema.designs.url, storeId: schema.designs.storeId })
    .from(schema.designs)
    .where(eq(schema.designs.id, body.designId))
    .limit(1);
  if (!design) return Response.json({ error: 'design not found' }, { status: 404 });
  if (!design.url) return Response.json({ error: 'design has no image' }, { status: 400 });
  if (!(await isStoreMember(design.storeId, user.id))) {
    return Response.json({ error: 'not your design' }, { status: 403 });
  }

  // The flat `preview_shots` debit is priced for 2 renders (credits.ts: "2 Nano Banana renders →
  // ~2x") and the generator makes ONE render per placement — cap so cost can't outrun the price.
  const placements = (body.placements?.length ? body.placements : [{ placement: 'front', label: 'front' }]).slice(0, 2);

  // Resolve any secondary designs referenced per placement; every one must live in the SAME store
  // as the primary (a composition never crosses stores), which the membership check above covers.
  const designUrlById = new Map<string, string>([[design.id, design.url]]);
  const extraIds = [...new Set(placements.map((p) => p.designId).filter((id): id is string => !!id && id !== design.id))];
  if (extraIds.length) {
    const extras = await db
      .select({ id: schema.designs.id, url: schema.designs.url, storeId: schema.designs.storeId })
      .from(schema.designs)
      .where(inArray(schema.designs.id, extraIds));
    for (const d of extras) {
      if (d.storeId !== design.storeId) return Response.json({ error: 'not your design' }, { status: 403 });
      if (d.url) designUrlById.set(d.id, d.url);
    }
  }

  try {
    await debit(user.id, 'preview_shots', design.id);
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return Response.json({ error: 'insufficient_credits', needed: e.needed, balance: e.balance }, { status: 402 });
    }
    throw e;
  }

  try {
    let shots: string[] = [];
    let mockupUrl: string | null = null;

    // 1) Ground truth: the real Printful mockup (skipped for data-URL designs — the generator
    //    needs a hosted image — or when only a garmentUrl was provided). Each placement carries
    //    its OWN design so a multi-print product mocks up complete.
    const placementUrl = (p: { designId?: string }) => designUrlById.get(p.designId ?? design.id) ?? design.url;
    if (body.templateKey && !placements.some((p) => placementUrl(p).startsWith('data:'))) {
      try {
        const variants = await getCatalogVariants(body.templateKey);
        const variantId = variants[0]?.id;
        if (variantId) {
          const meta = await getProductMeta(body.templateKey).catch(() => ({ technique: null, defaultOptions: {} }));
          const files: MockupFile[] = placements.map((p) => ({ placement: p.placement, image_url: placementUrl(p) }));
          const mockups = await renderMockups(
            body.templateKey,
            variantId,
            files,
            meta.technique,
            meta.technique === 'KNITWEAR' ? meta.defaultOptions : undefined,
          );
          mockupUrl = mockups[placements[0].placement] ?? Object.values(mockups)[0] ?? null;
          if (mockupUrl) shots = await generateModelShotsFromMockup(mockupUrl, placements, 2);
        }
      } catch {
        /* Printful mockup failed — fall through to the two-image path */
      }
    }

    // 2) Fallback: garment + design as separate images (placement is the model's guess).
    if (!shots.length && body.garmentUrl) {
      shots = await generateDesignOnModelShots(body.garmentUrl, design.url, placements, 2);
    }

    if (!shots.length) throw new Error('no shots generated');
    return Response.json({ shots, mockupUrl });
  } catch (e) {
    await grant(user.id, CREDIT_COSTS.preview_shots, 'refund', design.id).catch(() => {});
    return Response.json({ error: e instanceof Error ? e.message : 'Preview failed' }, { status: 502 });
  }
}
