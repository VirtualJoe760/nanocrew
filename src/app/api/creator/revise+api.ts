import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { storeForMember } from '@/lib/tenant';

type Annotation = { url: string; width: number; strokes: { x: number; y: number }[][] };

// POST /api/creator/revise { storeSlug, requestMd, screenshots?, annotations? }
// Records a revision and applies it on a WORKING BRANCH (never main). The site's
// preview deploy updates; the creator reviews, then approves to go to production.
// `annotations` (circled regions, document coords) are re-rendered into annotated
// screenshots on the forge for Claude — see lib/revise.ts.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const b = (await req.json()) as { storeSlug?: string; requestMd?: string; screenshots?: string[]; annotations?: Annotation[] };
    if (!b.storeSlug || !b.requestMd?.trim()) return Response.json({ error: 'storeSlug and requestMd required' }, { status: 400 });
    const store = await storeForMember(b.storeSlug, user.id);
    if (!store) return Response.json({ error: 'not found' }, { status: 404 });

    const annotations = (Array.isArray(b.annotations) ? b.annotations : [])
      .filter((a) => a && typeof a.url === 'string' && Array.isArray(a.strokes) && a.strokes.length > 0)
      .slice(0, 8);
    const branch = `revision/${Date.now().toString(36)}`;
    // Enqueue only — the forge worker on the droplet drains store_revisions one at a time.
    // The circled annotations ride in the `screenshots` jsonb column for the worker to render.
    const [rev] = await db
      .insert(schema.storeRevisions)
      .values({ storeId: store.id, requestMd: b.requestMd.trim(), screenshots: annotations, status: 'building', branch })
      .returning({ id: schema.storeRevisions.id });

    return Response.json({ revisionId: rev.id, branch, status: 'building' });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
