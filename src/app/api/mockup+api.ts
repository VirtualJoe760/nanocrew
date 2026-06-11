import { eq, inArray } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getProductMeta, renderMockups, type MockupFile } from '@/lib/printful';

// POST /api/mockup — render real Printful mockups for a composition's placements and
// persist positions + previewUrl. Positions arrive in print-file pixels and are clamped
// server-side so Printful never rejects them.

interface PositionInput {
  areaWidth: number;
  areaHeight: number;
  width: number;
  height: number;
  top: number;
  left: number;
}
interface PlacementInput {
  placement: string;
  designId: string;
  position: PositionInput | null;
}

function clamp(p: PositionInput): PositionInput {
  const areaWidth = Math.max(1, Math.round(p.areaWidth));
  const areaHeight = Math.max(1, Math.round(p.areaHeight));
  const width = Math.min(Math.max(1, Math.round(p.width)), areaWidth);
  const height = Math.min(Math.max(1, Math.round(p.height)), areaHeight);
  const left = Math.min(Math.max(0, Math.round(p.left)), areaWidth - width);
  const top = Math.min(Math.max(0, Math.round(p.top)), areaHeight - height);
  return { areaWidth, areaHeight, width, height, top, left };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      compositionId?: string;
      templateKey?: string;
      variantId?: number;
      placements?: PlacementInput[];
    } | null;
    if (!body?.compositionId || !body.templateKey || !body.variantId || !body.placements?.length) {
      return Response.json(
        { error: 'compositionId, templateKey, variantId, placements required' },
        { status: 400 },
      );
    }

    const ids = [...new Set(body.placements.map((p) => p.designId))];
    const rows = await db
      .select({ id: schema.designs.id, url: schema.designs.url })
      .from(schema.designs)
      .where(inArray(schema.designs.id, ids));
    const urlById = new Map(rows.map((r) => [r.id, r.url]));

    const clamped = body.placements
      .filter((p) => {
        const url = urlById.get(p.designId);
        return url && !url.startsWith('data:'); // mockup generator needs a public URL
      })
      .map((p) => ({ ...p, position: p.position ? clamp(p.position) : null }));
    if (!clamped.length) {
      return Response.json({ error: 'no usable designs (need hosted image URLs)' }, { status: 400 });
    }

    const files: MockupFile[] = clamped.map((p) => ({
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
            },
          }
        : {}),
    }));

    // Non-DTG products (knitwear, cut & sew, embroidery) require their technique on the
    // task, and knitwear additionally requires product options (base/trim colors) —
    // default each declared option to its first value.
    const meta = await getProductMeta(body.templateKey).catch(() => ({
      technique: null,
      defaultOptions: {},
    }));
    const mockups = await renderMockups(
      body.templateKey,
      body.variantId,
      files,
      meta.technique,
      meta.technique === 'KNITWEAR' ? meta.defaultOptions : undefined,
    );
    const previewUrl = mockups.front ?? Object.values(mockups)[0] ?? null;

    await db
      .update(schema.compositions)
      .set({
        placements: clamped.map((p) => ({
          placement: p.placement,
          designId: p.designId,
          position: p.position,
        })),
        ...(previewUrl ? { previewUrl, status: 'draft' as const } : {}),
      })
      .where(eq(schema.compositions.id, body.compositionId));

    return Response.json({ mockups, previewUrl });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Mockup failed' }, { status: 502 });
  }
}
