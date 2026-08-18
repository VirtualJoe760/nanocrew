import { and, eq, inArray } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { TenantError, assertCompositionOwner } from '@/lib/tenant';

// GET /api/compositions/:id → full row (the PlacementEditor self-hydrates from this).
// PATCH /api/compositions/:id → update preview/status after the composite render, and/or persist
//   `placements` (the PlacementEditor autosaves as the creator drags — before this, edits only
//   reached the DB via /api/mockup, so publishing without rendering a mockup silently used the
//   default placement; review 2026-08-17).
// DELETE /api/compositions/:id → discard. All scoped to the owning creator.

interface PositionInput {
  areaWidth: number;
  areaHeight: number;
  width: number;
  height: number;
  top: number;
  left: number;
  limitToPrintArea?: boolean;
}
interface PlacementInput {
  placement: string;
  designId: string;
  position: PositionInput | null;
}

// Same server-side clamp as /api/mockup — the client is not trusted with print geometry.
function clamp(p: PositionInput): PositionInput {
  const areaWidth = Math.max(1, Math.round(p.areaWidth));
  const areaHeight = Math.max(1, Math.round(p.areaHeight));
  const bleed = p.limitToPrintArea === false;
  const maxW = bleed ? areaWidth * 2 : areaWidth;
  const maxH = bleed ? areaHeight * 2 : areaHeight;
  const width = Math.min(Math.max(1, Math.round(p.width)), maxW);
  const height = Math.min(Math.max(1, Math.round(p.height)), maxH);
  const left = Math.min(Math.max(bleed ? -width : 0, Math.round(p.left)), areaWidth - (bleed ? 1 : width));
  const top = Math.min(Math.max(bleed ? -height : 0, Math.round(p.top)), areaHeight - (bleed ? 1 : height));
  return { areaWidth, areaHeight, width, height, top, left, limitToPrintArea: p.limitToPrintArea };
}

function fail(e: unknown) {
  const status = e instanceof TenantError ? e.status : 500;
  return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status });
}

export async function GET(req: Request, { id }: Record<string, string>) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
  try {
    await assertCompositionOwner(id, user.id);
    const rows = await db.select().from(schema.compositions).where(eq(schema.compositions.id, id)).limit(1);
    if (!rows.length) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({ composition: rows[0] });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: Request, { id }: Record<string, string>) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
  try {
    const storeId = await assertCompositionOwner(id, user.id);
    const body = (await req.json().catch(() => null)) as {
      previewUrl?: string;
      status?: 'generating' | 'draft' | 'approved' | 'published' | 'failed';
      errorMessage?: string;
      placements?: PlacementInput[];
    } | null;
    const patch: Record<string, unknown> = {};
    if (body?.previewUrl !== undefined) patch.previewUrl = body.previewUrl;
    if (body?.status) patch.status = body.status;
    if (body?.errorMessage !== undefined) patch.errorMessage = body.errorMessage;
    if (Array.isArray(body?.placements) && body.placements.length) {
      // IDOR: designIds come from the client — only accept designs owned by this creator's store
      // (mirrors /api/mockup and /api/merge).
      const ids = [...new Set(body.placements.map((p) => p?.designId).filter(Boolean))];
      const rows = await db
        .select({ id: schema.designs.id })
        .from(schema.designs)
        .where(and(inArray(schema.designs.id, ids), eq(schema.designs.storeId, storeId)));
      const owned = new Set(rows.map((r) => r.id));
      const cleaned = body.placements
        .filter((p) => p && typeof p.placement === 'string' && owned.has(p.designId))
        .map((p) => ({
          placement: p.placement,
          designId: p.designId,
          position: p.position ? clamp(p.position) : null,
        }));
      if (cleaned.length) patch.placements = cleaned;
    }
    if (!Object.keys(patch).length) return Response.json({ error: 'nothing to update' }, { status: 400 });
    await db.update(schema.compositions).set(patch).where(eq(schema.compositions.id, id));
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request, { id }: Record<string, string>) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
  try {
    await assertCompositionOwner(id, user.id);
    await db.delete(schema.compositions).where(eq(schema.compositions.id, id));
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
