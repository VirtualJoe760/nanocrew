import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { TenantError, assertDesignOwner } from '@/lib/tenant';

// DELETE /api/designs/:id → remove a design the creator owns. Compositions made from it are
// removed too via the design_id FK cascade. Canvas nodes reference designs by a text id
// (no FK), so the client prunes any nodes that point at this design.
export async function DELETE(req: Request, { id }: Record<string, string>) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
  try {
    await assertDesignOwner(id, user.id);
    await db.delete(schema.designs).where(eq(schema.designs.id, id));
    return Response.json({ ok: true });
  } catch (e) {
    const status = e instanceof TenantError ? e.status : 500;
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status });
  }
}
