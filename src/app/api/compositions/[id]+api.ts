import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { TenantError, assertCompositionOwner } from '@/lib/tenant';

// GET /api/compositions/:id → full row (the PlacementEditor self-hydrates from this).
// PATCH /api/compositions/:id → update preview/status after the composite render.
// DELETE /api/compositions/:id → discard. All scoped to the owning creator.

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
    await assertCompositionOwner(id, user.id);
    const body = (await req.json().catch(() => null)) as {
      previewUrl?: string;
      status?: 'generating' | 'draft' | 'approved' | 'published' | 'failed';
      errorMessage?: string;
    } | null;
    const patch: Record<string, unknown> = {};
    if (body?.previewUrl !== undefined) patch.previewUrl = body.previewUrl;
    if (body?.status) patch.status = body.status;
    if (body?.errorMessage !== undefined) patch.errorMessage = body.errorMessage;
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
