import { and, eq } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { reviseStorefront } from '@/lib/revise';

// POST /api/creator/revise { storeSlug, requestMd, screenshots? }
// Records a revision and applies it on a WORKING BRANCH (never main). The site's
// preview deploy updates; the creator reviews, then approves to go to production.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const b = (await req.json()) as { storeSlug?: string; requestMd?: string; screenshots?: string[] };
    if (!b.storeSlug || !b.requestMd?.trim()) return Response.json({ error: 'storeSlug and requestMd required' }, { status: 400 });
    const [store] = await db
      .select({ id: schema.stores.id, slug: schema.stores.slug, name: schema.stores.name })
      .from(schema.stores)
      .where(and(eq(schema.stores.slug, b.storeSlug), eq(schema.stores.creatorId, user.id)))
      .limit(1);
    if (!store) return Response.json({ error: 'not found' }, { status: 404 });

    const screenshots = (b.screenshots ?? []).filter((s) => typeof s === 'string').slice(0, 8);
    const branch = `revision/${Date.now().toString(36)}`;
    const [rev] = await db
      .insert(schema.storeRevisions)
      .values({ storeId: store.id, requestMd: b.requestMd.trim(), screenshots, status: 'building', branch })
      .returning({ id: schema.storeRevisions.id });

    void reviseStorefront({
      revisionId: rev.id,
      storeId: store.id,
      slug: store.slug,
      storeName: store.name,
      branch,
      requestMd: b.requestMd.trim(),
      screenshots,
    });
    return Response.json({ revisionId: rev.id, branch, status: 'building' });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
