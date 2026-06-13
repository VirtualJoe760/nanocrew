import { desc, eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { TenantError, assertCatalogueOwner } from '@/lib/tenant';

// GET  /api/canvas/:id  → { designs, nodes, compositions } for a catalogue (id = catalogueId)
// PUT  /api/canvas/:id  → replace-all canvas nodes for a catalogue (one transaction)

function fail(e: unknown) {
  const status = e instanceof TenantError ? e.status : 500;
  return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status });
}

export async function GET(req: Request, { id }: Record<string, string>) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (!id) return Response.json({ error: 'missing catalogue id' }, { status: 400 });
  try {
    await assertCatalogueOwner(id, user.id);
    const [designs, nodes, compositions] = await Promise.all([
      db
        .select({
          id: schema.designs.id,
          prompt: schema.designs.prompt,
          url: schema.designs.url,
        })
        .from(schema.designs)
        .where(eq(schema.designs.catalogueId, id))
        .orderBy(desc(schema.designs.createdAt)),
      db.select().from(schema.canvasNodes).where(eq(schema.canvasNodes.catalogueId, id)),
      db
        .select({
          id: schema.compositions.id,
          designId: schema.compositions.designId,
          templateKey: schema.compositions.templateKey,
          placement: schema.compositions.placement,
          previewUrl: schema.compositions.previewUrl,
          status: schema.compositions.status,
        })
        .from(schema.compositions)
        .where(eq(schema.compositions.catalogueId, id)),
    ]);
    return Response.json({ designs, nodes, compositions });
  } catch (e) {
    return fail(e);
  }
}

interface NodeInput {
  kind: string;
  refId: string;
  groupId?: string | null;
  x: number;
  y: number;
  width?: number | null;
  height?: number | null;
  scale?: number; // app uses 1.0 = default; stored as integer percent
  zIndex?: number;
  colorImage?: string | null;
  selectedColor?: string | null;
}

export async function PUT(req: Request, { id }: Record<string, string>) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (!id) return Response.json({ error: 'missing catalogue id' }, { status: 400 });
  try {
    await assertCatalogueOwner(id, user.id);
    const body = (await req.json().catch(() => null)) as { nodes?: NodeInput[] } | null;
    if (!body?.nodes) return Response.json({ error: 'nodes is required' }, { status: 400 });

    const rows = body.nodes.map((n) => ({
      catalogueId: id,
      kind: String(n.kind),
      refId: String(n.refId),
      groupId: n.groupId ?? null,
      x: Math.round(n.x ?? 0),
      y: Math.round(n.y ?? 0),
      width: n.width != null ? Math.round(n.width) : null,
      height: n.height != null ? Math.round(n.height) : null,
      scale: Math.round((n.scale ?? 1) * 100),
      zIndex: n.zIndex ?? 0,
      colorImage: n.colorImage ?? null,
      selectedColor: n.selectedColor ?? null,
    }));

    await db.transaction(async (tx) => {
      await tx.delete(schema.canvasNodes).where(eq(schema.canvasNodes.catalogueId, id));
      if (rows.length) await tx.insert(schema.canvasNodes).values(rows);
    });
    return Response.json({ ok: true, count: rows.length });
  } catch (e) {
    return fail(e);
  }
}
