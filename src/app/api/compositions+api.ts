import { and, eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { TenantError, assertCatalogueOwner, assertDesignOwner } from '@/lib/tenant';
import { getBlankPrintareas, getProductMeta } from '@/lib/printful';

// POST /api/compositions → create a composition row (status: generating) and return its
// id. Fabrication-aware: if the product's technique can't reproduce the design as-is
// (KNITWEAR → flat yarn-palette artwork only), we regenerate a compliant version, save
// it as a new design, use it for the composition, and tell the client so it can inform
// the user.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const body = (await req.json().catch(() => null)) as {
      catalogueId?: string;
      designId?: string;
      templateKey?: string;
      placement?: string;
      /** Multi-design combine (front/back/sleeves…) — overrides designId/placement when given. */
      placements?: { designId: string; placement: string }[];
    } | null;
    // Normalize to a placement list: explicit placements[] (multi-design combine), else the legacy
    // single designId+placement pair. The FIRST entry is the primary (drives preview + knit adapt).
    const list = body?.placements?.length
      ? body.placements.filter((p) => p?.designId && p?.placement)
      : body?.designId
        ? [{ designId: body.designId, placement: body.placement || 'front' }]
        : [];
    if (!body?.catalogueId || !body.templateKey || !list.length) {
      return Response.json({ error: 'catalogueId, templateKey, designId(s) required' }, { status: 400 });
    }
    const storeId = await assertCatalogueOwner(body.catalogueId, user.id);

    // FAIL HERE, NOT AT PUBLISH (BUG_AUDIT_2026-08-20 #27 / B12). Printful placement keys are
    // per-product — an all-over tee prints 'front_dtfabric', not 'front' — and the route used to
    // accept any string, so the creator finished the whole flow and hit a raw passthrough
    // '502 Printful 400: Incorrect file type: front' at publish. Best-effort: a Printful blip
    // must not block a composition, so an empty/failed lookup skips the check.
    const printable = await getBlankPrintareas(body.templateKey)
      .then((pa) => pa.areas.map((a) => a.placement))
      .catch(() => [] as string[]);
    if (printable.length) {
      const bad = [...new Set(list.map((p) => p.placement))].filter((p) => !printable.includes(p));
      if (bad.length) {
        return Response.json(
          {
            error: `This product can't print ${bad.join(', ')} — it prints ${printable.join(', ')}.`,
            allowedPlacements: printable,
          },
          { status: 422 },
        );
      }
    }
    // IDOR FIX: the catalogue is the caller's, but the design ids come from the client — verify the
    // caller owns EVERY design AND that each lives in the SAME store, or one creator could bake another
    // creator's private design into their own composition/product (realized downstream in publish).
    for (const id of [...new Set(list.map((p) => p.designId))]) {
      const designStoreId = await assertDesignOwner(id, user.id);
      if (designStoreId !== storeId) {
        throw new TenantError('design does not belong to this store', 403);
      }
    }

    let designId = list[0].designId;
    let adaptedDesign: { id: string; url: string; prompt: string } | null = null;

    // Technique adaptation (KNITWEAR · EMBROIDERY — lib/technique.ts) applies to the PRIMARY
    // design only — multi-placement edge cases pass through unadapted rather than blocking the
    // combine. A design that was already GENERATED for this technique (designs.technique set by
    // /api/generate when the blank was known up front) is producible as-is — skip the re-adapt,
    // which would double-spend a model call on art that's already right.
    const meta = await getProductMeta(body.templateKey).catch(() => null);
    const fabTechnique =
      meta?.technique === 'KNITWEAR' || meta?.technique === 'EMBROIDERY' ? meta.technique : null;
    if (fabTechnique) {
      const [original] = await db
        .select({ url: schema.designs.url, prompt: schema.designs.prompt, technique: schema.designs.technique })
        .from(schema.designs)
        .where(and(eq(schema.designs.id, designId), eq(schema.designs.storeId, storeId)))
        .limit(1);
      if (original && original.technique !== fabTechnique && !original.url.startsWith('data:')) {
        try {
          const { adaptDesignForTechnique, hostAdaptedDesign } = await import('@/lib/adapt');
          const yarn = meta?.defaultOptions.yarn_colors;
          const palette = Array.isArray(yarn) ? yarn : ['#090909', '#fdfafa', '#999996', '#d52213'];
          const buffer = await adaptDesignForTechnique(original.url, fabTechnique, palette);
          const url = await hostAdaptedDesign(buffer);
          const prompt = `${fabTechnique === 'KNITWEAR' ? 'Knit' : 'Embroidery'}-adapted — ${original.prompt.slice(0, 70)}`;
          const [row] = await db
            .insert(schema.designs)
            .values({ storeId, catalogueId: body.catalogueId, prompt, url, technique: fabTechnique })
            .returning({ id: schema.designs.id });
          designId = row.id;
          adaptedDesign = { id: row.id, url, prompt };
        } catch {
          // Adaptation failure shouldn't block the combine — fall back to the original.
        }
      }
    }

    // Primary lands on the legacy designId/placement columns; a multi-design combine ALSO writes
    // the placements[] source of truth (position null = Printful auto-fit until the editor sets one).
    // The primary's id reflects any knit adaptation.
    const finalList = list.map((p, i) => ({
      placement: p.placement,
      designId: i === 0 ? designId : p.designId,
      position: null,
    }));
    const [row] = await db
      .insert(schema.compositions)
      .values({
        storeId,
        catalogueId: body.catalogueId,
        designId,
        templateKey: String(body.templateKey),
        placement: finalList[0].placement,
        ...(finalList.length > 1 ? { placements: finalList } : {}),
      })
      .returning({ id: schema.compositions.id });
    return Response.json({
      composition: row,
      ...(adaptedDesign ? { adaptedDesign, technique: meta?.technique } : {}),
    });
  } catch (e) {
    const status = e instanceof TenantError ? e.status : 500;
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status });
  }
}
