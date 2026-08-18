import { and, eq, inArray } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { guardRate } from '@/lib/rate-limit';
import { TenantError, assertCompositionOwner } from '@/lib/tenant';
import {
  getCatalogVariants,
  getMockupOptionGroups,
  getProductMeta,
  renderMockupsForVariants,
  type MockupFile,
} from '@/lib/printful';

// POST /api/creator/color-mockups { compositionId, templateKey, colors? }
// → { mockups: { [color]: url }, style }
// Hyper-real per-COLOUR product shots for the pricing page (Joe, 2026-08-18): one Printful
// generator task across one variant per colourway, preferring the product's photographed
// ON-MODEL style when it has one ("Men's"/"Women's"), falling back to flat. Free — Printful's
// generator, not paid AI. Uses the composition's SAVED placements (the editor autosaves them).

const MODEL_GROUPS = ["Men's", "Women's", "Men's Lifestyle", "Women's Lifestyle"];
const MAX_COLORS = 10;

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const limited = await guardRate(`pf:${user.id}`, 60, 60);
  if (limited) return limited;
  try {
    const body = (await req.json().catch(() => null)) as {
      compositionId?: string;
      templateKey?: string;
      colors?: string[];
    } | null;
    if (!body?.compositionId || !body.templateKey) {
      return Response.json({ error: 'compositionId, templateKey required' }, { status: 400 });
    }
    const storeId = await assertCompositionOwner(body.compositionId, user.id);

    const [comp] = await db
      .select({
        designId: schema.compositions.designId,
        placement: schema.compositions.placement,
        placements: schema.compositions.placements,
      })
      .from(schema.compositions)
      .where(eq(schema.compositions.id, body.compositionId))
      .limit(1);
    if (!comp) return Response.json({ error: 'composition not found' }, { status: 404 });

    const saved = comp.placements?.length
      ? comp.placements
      : [{ placement: comp.placement, designId: comp.designId, position: null }];
    const ids = [...new Set(saved.map((p) => p.designId))];
    const rows = await db
      .select({ id: schema.designs.id, url: schema.designs.url })
      .from(schema.designs)
      .where(and(inArray(schema.designs.id, ids), eq(schema.designs.storeId, storeId)));
    const urlById = new Map(rows.map((r) => [r.id, r.url]));
    const files: MockupFile[] = saved
      .filter((p) => {
        const url = urlById.get(p.designId);
        return url && !url.startsWith('data:');
      })
      .map((p) => ({
        placement: p.placement,
        image_url: urlById.get(p.designId)!,
        ...(p.position
          ? {
              position: {
                area_width: p.position.areaWidth,
                area_height: p.position.areaHeight,
                width: p.position.width,
                height: p.position.height,
                top: p.position.top,
                left: p.position.left,
                ...(p.position.limitToPrintArea === false ? { limit_to_print_area: false } : {}),
              },
            }
          : {}),
      }));
    if (!files.length) {
      return Response.json({ error: 'no usable designs (need hosted image URLs)' }, { status: 400 });
    }

    // One variant per requested colourway (first size stands in for the colour).
    const variants = await getCatalogVariants(body.templateKey);
    const wanted = body.colors?.length ? new Set(body.colors) : null;
    const byColor = new Map<string, number>();
    for (const v of variants) {
      if (wanted && !wanted.has(v.color)) continue;
      if (!byColor.has(v.color)) byColor.set(v.color, v.id);
      if (byColor.size >= MAX_COLORS) break;
    }
    if (!byColor.size) return Response.json({ error: 'no matching colours' }, { status: 400 });

    // Prefer the photographed on-model style; fall back to the generator default (flat).
    const groups = await getMockupOptionGroups(body.templateKey).catch(() => [] as string[]);
    const style = MODEL_GROUPS.find((g) => groups.includes(g)) ?? null;

    const meta = await getProductMeta(body.templateKey).catch(() => ({
      technique: null,
      defaultOptions: {} as Record<string, string | string[]>,
    }));
    const results = await renderMockupsForVariants(body.templateKey, [...byColor.values()], files, {
      optionGroups: style ? [style] : undefined,
      technique: meta.technique,
      productOptions: meta.technique === 'KNITWEAR' ? meta.defaultOptions : undefined,
    });

    const colorByVariant = new Map<number, string>();
    for (const [color, vid] of byColor) colorByVariant.set(vid, color);
    const mockups: Record<string, string> = {};
    for (const r of results) {
      for (const vid of r.variantIds) {
        const color = colorByVariant.get(vid);
        if (color && !mockups[color]) mockups[color] = r.url;
      }
    }
    return Response.json({ mockups, style });
  } catch (e) {
    const status = e instanceof TenantError ? e.status : 502;
    return Response.json({ error: e instanceof Error ? e.message : 'Colour mockups failed' }, { status });
  }
}
