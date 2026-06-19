import { eq } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { declineRevision } from '@/lib/revise';
import { isStoreMember } from '@/lib/tenant';

// POST /api/creator/revisions/:id/decline — the creator rejected the preview. The change only ever
// lived on a working branch (never merged), so this discards that branch and marks the revision
// 'declined'. Ownership-checked; only a building/ready revision can be declined.
export async function POST(_req: Request, { id }: Record<string, string>) {
  const user = await getUserFromRequest(_req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const [rev] = await db
    .select({
      id: schema.storeRevisions.id,
      storeId: schema.storeRevisions.storeId,
      branch: schema.storeRevisions.branch,
      status: schema.storeRevisions.status,
      slug: schema.stores.slug,
    })
    .from(schema.storeRevisions)
    .innerJoin(schema.stores, eq(schema.stores.id, schema.storeRevisions.storeId))
    .where(eq(schema.storeRevisions.id, id))
    .limit(1);
  if (!rev) return Response.json({ error: 'not found' }, { status: 404 });
  if (!(await isStoreMember(rev.storeId, user.id))) return Response.json({ error: 'forbidden' }, { status: 403 });
  if (rev.status !== 'ready' && rev.status !== 'building' && rev.status !== 'failed') {
    return Response.json({ error: `cannot decline a ${rev.status} revision` }, { status: 409 });
  }

  await declineRevision({ revisionId: rev.id, slug: rev.slug, branch: rev.branch });
  return Response.json({ status: 'declined' });
}
