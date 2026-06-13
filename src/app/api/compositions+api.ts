import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { TenantError, assertCatalogueOwner } from '@/lib/tenant';
import { getProductMeta } from '@/lib/printful';

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
    } | null;
    if (!body?.catalogueId || !body.designId || !body.templateKey) {
      return Response.json({ error: 'catalogueId, designId, templateKey required' }, { status: 400 });
    }
    const storeId = await assertCatalogueOwner(body.catalogueId, user.id);

    let designId = body.designId;
    let adaptedDesign: { id: string; url: string; prompt: string } | null = null;

    const meta = await getProductMeta(body.templateKey).catch(() => null);
    if (meta?.technique === 'KNITWEAR') {
      const [original] = await db
        .select({ url: schema.designs.url, prompt: schema.designs.prompt })
        .from(schema.designs)
        .where(eq(schema.designs.id, body.designId))
        .limit(1);
      if (original && !original.url.startsWith('data:')) {
        try {
          const { adaptDesignForKnit, hostAdaptedDesign } = await import('@/lib/adapt');
          const yarn = meta.defaultOptions.yarn_colors;
          const palette = Array.isArray(yarn) ? yarn : ['#090909', '#fdfafa', '#999996', '#d52213'];
          const buffer = await adaptDesignForKnit(original.url, palette);
          const url = await hostAdaptedDesign(buffer);
          const prompt = `Knit-adapted — ${original.prompt.slice(0, 70)}`;
          const [row] = await db
            .insert(schema.designs)
            .values({ storeId, catalogueId: body.catalogueId, prompt, url })
            .returning({ id: schema.designs.id });
          designId = row.id;
          adaptedDesign = { id: row.id, url, prompt };
        } catch {
          // Adaptation failure shouldn't block the combine — fall back to the original.
        }
      }
    }

    const [row] = await db
      .insert(schema.compositions)
      .values({
        storeId,
        catalogueId: body.catalogueId,
        designId,
        templateKey: String(body.templateKey),
        placement: body.placement || 'front',
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
