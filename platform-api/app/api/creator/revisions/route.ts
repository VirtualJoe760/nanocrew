import { desc, eq } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { corsJson, corsPreflight } from '@/lib/cors';
import { db, schema } from '@/lib/db';
import { storeForMember } from '@/lib/tenant';

export const OPTIONS = corsPreflight;

// GET /api/creator/revisions?storeSlug=… — recent revisions for an owned store, so the brand's
// /admin can show what's building, ready to review, or live. Mirrors the app route.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return corsJson({ error: 'unauthorized' }, { status: 401 });
  const storeSlug = new URL(req.url).searchParams.get('storeSlug');
  if (!storeSlug) return corsJson({ error: 'storeSlug required' }, { status: 400 });
  const store = await storeForMember(storeSlug, user.id);
  if (!store) return corsJson({ error: 'not found' }, { status: 404 });

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
  return corsJson({ revisions });
}
