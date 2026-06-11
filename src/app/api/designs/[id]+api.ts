import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// DELETE /api/designs/:id → remove a design. Compositions made from it are removed too via
// the design_id FK cascade. Canvas nodes reference designs by a text id (no FK), so the
// client prunes any nodes that point at this design.
export async function DELETE(_req: Request, { id }: Record<string, string>) {
  if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
  try {
    await db.delete(schema.designs).where(eq(schema.designs.id, id));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
