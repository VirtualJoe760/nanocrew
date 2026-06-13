import { and, eq } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { reviseStorefront } from '@/lib/revise';

// POST /api/creator/revise { storeSlug, request } — queue a plain-language site change.
// Ownership-checked; the forge applies it asynchronously and the site redeploys.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const b = (await req.json()) as { storeSlug?: string; request?: string };
    if (!b.storeSlug || !b.request?.trim()) return Response.json({ error: 'storeSlug and request required' }, { status: 400 });
    const [store] = await db
      .select({ id: schema.stores.id, slug: schema.stores.slug, name: schema.stores.name })
      .from(schema.stores)
      .where(and(eq(schema.stores.slug, b.storeSlug), eq(schema.stores.creatorId, user.id)))
      .limit(1);
    if (!store) return Response.json({ error: 'not found' }, { status: 404 });

    void reviseStorefront({ storeId: store.id, slug: store.slug, storeName: store.name, request: b.request.trim() });
    return Response.json({ queued: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
