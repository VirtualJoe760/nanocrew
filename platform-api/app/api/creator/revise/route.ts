import { getUserFromRequest } from '@/lib/auth';
import { corsJson, corsPreflight } from '@/lib/cors';
import { db, schema } from '@/lib/db';
import { storeForMember } from '@/lib/tenant';

export const OPTIONS = corsPreflight;

// POST /api/creator/revise { storeSlug, requestMd } — request a site change from the brand's own
// /admin. Mirrors the app route: ENQUEUE ONLY (insert store_revisions, status 'building', on a
// working branch). The forge worker on the droplet drains the queue and applies it on a preview;
// the creator reviews, then approves to merge to production. (No circle annotations from the web
// editor — those are an in-app feature.)
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return corsJson({ error: 'unauthorized' }, { status: 401 });
  try {
    const b = (await req.json()) as { storeSlug?: string; requestMd?: string };
    if (!b.storeSlug || !b.requestMd?.trim()) return corsJson({ error: 'storeSlug and requestMd required' }, { status: 400 });
    const store = await storeForMember(b.storeSlug, user.id);
    if (!store) return corsJson({ error: 'not found' }, { status: 404 });

    const branch = `revision/${Date.now().toString(36)}`;
    const [rev] = await db
      .insert(schema.storeRevisions)
      .values({ storeId: store.id, requestMd: b.requestMd.trim(), status: 'building', branch })
      .returning({ id: schema.storeRevisions.id });

    return corsJson({ revisionId: rev.id, branch, status: 'building' });
  } catch (e) {
    return corsJson({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
