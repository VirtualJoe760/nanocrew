import { eq } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { isStoreMember } from '@/lib/tenant';
import { approveRevision } from '@/lib/revise';

// POST /api/creator/revisions/:id/approve — the creator approved the preview; merge the
// working branch into main (production deploy). Ownership-checked; only 'ready' merges.
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
  if (rev.status !== 'ready') return Response.json({ error: `cannot approve a ${rev.status} revision` }, { status: 409 });

  const ok = await approveRevision({ revisionId: rev.id, slug: rev.slug, branch: rev.branch });
  return Response.json(ok ? { status: 'approved' } : { error: 'merge failed' }, { status: ok ? 200 : 500 });
}
