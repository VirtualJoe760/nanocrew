import { eq } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { uploadImage } from '@/lib/cloudinary';
import { featherEdges } from '@/lib/transparency';
import { TenantError, assertDesignOwner } from '@/lib/tenant';

// POST /api/creator/design-feather { designId, radius? } — Photoshop-style edge feather on a
// design's PNG (Joe, 2026-08-17). Deterministic pixel op: no AI, no credits. Saves the feathered
// image as the design's new url and returns it.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { designId?: string; radius?: number } | null;
  if (!body?.designId) return Response.json({ error: 'designId required' }, { status: 400 });
  try {
    await assertDesignOwner(body.designId, user.id);
    const [design] = await db
      .select({ id: schema.designs.id, url: schema.designs.url })
      .from(schema.designs)
      .where(eq(schema.designs.id, body.designId))
      .limit(1);
    if (!design?.url) return Response.json({ error: 'design not found' }, { status: 404 });
    const res = await fetch(design.url);
    if (!res.ok) throw new Error('could not load the design image');
    const feathered = featherEdges(Buffer.from(await res.arrayBuffer()), body.radius);
    const image = await uploadImage(feathered, { folder: 'nanocrew/designs' });
    await db.update(schema.designs).set({ url: image }).where(eq(schema.designs.id, design.id));
    return Response.json({ image, id: design.id });
  } catch (e) {
    const status = e instanceof TenantError ? e.status : 502;
    return Response.json({ error: e instanceof Error ? e.message : 'Feather failed' }, { status });
  }
}
