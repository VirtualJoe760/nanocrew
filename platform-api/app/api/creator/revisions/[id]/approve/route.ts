import { and, eq } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { corsJson, corsPreflight } from '@/lib/cors';
import { db, schema } from '@/lib/db';
import { mergeRevisionBranch } from '@/lib/github';

export const OPTIONS = corsPreflight;

// POST /api/creator/revisions/:id/approve — the creator approved the preview from their site's
// /admin; merge the working branch into main (production deploy) via GitHub's API. Ownership-checked;
// only a 'ready' revision merges.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest(req);
  if (!user) return corsJson({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;

  const [rev] = await db
    .select({
      id: schema.storeRevisions.id,
      branch: schema.storeRevisions.branch,
      status: schema.storeRevisions.status,
      slug: schema.stores.slug,
    })
    .from(schema.storeRevisions)
    .innerJoin(schema.stores, eq(schema.stores.id, schema.storeRevisions.storeId))
    .where(and(eq(schema.storeRevisions.id, id), eq(schema.stores.creatorId, user.id)))
    .limit(1);
  if (!rev) return corsJson({ error: 'not found' }, { status: 404 });
  if (rev.status !== 'ready') return corsJson({ error: `cannot approve a ${rev.status} revision` }, { status: 409 });

  try {
    const merged = await mergeRevisionBranch(rev.slug, rev.branch);
    if (!merged) return corsJson({ error: 'merge conflict — ask Venus to redo this change' }, { status: 409 });
    await db.update(schema.storeRevisions).set({ status: 'approved' }).where(eq(schema.storeRevisions.id, rev.id));
    return corsJson({ status: 'approved' });
  } catch (e) {
    return corsJson({ error: e instanceof Error ? e.message : 'merge failed' }, { status: 500 });
  }
}
