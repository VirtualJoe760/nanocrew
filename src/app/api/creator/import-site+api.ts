import { and, eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';

// POST /api/creator/import-site { storeSlug, url } — connect a website the creator already
// has. We point the brand's deployment at that URL so the shop + console link to it. (No
// scraping yet — this just adopts an existing site; a future pass can import its design.)
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { storeSlug?: string; url?: string } | null;
  if (!body?.storeSlug || !body.url) return Response.json({ error: 'storeSlug and url required' }, { status: 400 });

  // Normalise + validate the URL.
  let url = body.url.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const u = new URL(url);
    if (!u.hostname.includes('.')) throw new Error('bad host');
    url = u.origin;
  } catch {
    return Response.json({ error: 'invalid url' }, { status: 400 });
  }

  try {
    const [store] = await db
      .select({ id: schema.stores.id })
      .from(schema.stores)
      .where(and(eq(schema.stores.slug, body.storeSlug), eq(schema.stores.creatorId, user.id)))
      .limit(1);
    if (!store) return Response.json({ error: 'not found' }, { status: 404 });

    await db.update(schema.stores).set({ deploymentUrl: url, status: 'live' }).where(eq(schema.stores.id, store.id));
    return Response.json({ ok: true, url });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
