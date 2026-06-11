import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// GET /api/compositions/:id → full row (the PlacementEditor self-hydrates from this).
// PATCH /api/compositions/:id → update preview/status after the composite render.
// DELETE /api/compositions/:id → discard.

export async function GET(_req: Request, { id }: Record<string, string>) {
  if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
  try {
    const rows = await db.select().from(schema.compositions).where(eq(schema.compositions.id, id)).limit(1);
    if (!rows.length) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({ composition: rows[0] });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}

export async function PATCH(req: Request, { id }: Record<string, string>) {
  if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
  try {
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
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { id }: Record<string, string>) {
  if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
  try {
    await db.delete(schema.compositions).where(eq(schema.compositions.id, id));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
