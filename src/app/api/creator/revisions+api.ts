import { and, desc, eq } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';

// GET /api/creator/revisions?storeSlug=… — recent revisions for an owned store,
// so Studio can show what's building, ready to review, or live.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const storeSlug = new URL(req.url).searchParams.get('storeSlug');
  if (!storeSlug) return Response.json({ error: 'storeSlug required' }, { status: 400 });
  const [store] = await db
    .select({ id: schema.stores.id })
    .from(schema.stores)
    .where(and(eq(schema.stores.slug, storeSlug), eq(schema.stores.creatorId, user.id)))
    .limit(1);
  if (!store) return Response.json({ error: 'not found' }, { status: 404 });

  const revisions = await db
    .select({
      id: schema.storeRevisions.id,
      requestMd: schema.storeRevisions.requestMd,
      status: schema.storeRevisions.status,
      branch: schema.storeRevisions.branch,
      previewUrl: schema.storeRevisions.previewUrl,
      createdAt: schema.storeRevisions.createdAt,
    })
    .from(schema.storeRevisions)
    .where(eq(schema.storeRevisions.storeId, store.id))
    .orderBy(desc(schema.storeRevisions.createdAt))
    .limit(20);
  return Response.json({ revisions });
}
