import { and, eq } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { attachDomain, normalizeDomain } from '@/lib/domains';

// POST /api/creator/stores/:slug/go-live { domain } — attach a custom domain to the store's
// Vercel project and, once Vercel verifies it, flip the store to `live`. Idempotent: if the
// domain isn't pointed at Vercel yet, returns the DNS records to set; call again after to verify.
// "Going live" == a domain is attached (Phase C); the store lives on store-<slug>.vercel.app until then.
export async function POST(req: Request, { slug }: Record<string, string>) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const [store] = await db
    .select({ id: schema.stores.id, slug: schema.stores.slug, status: schema.stores.status })
    .from(schema.stores)
    .where(and(eq(schema.stores.slug, slug), eq(schema.stores.creatorId, user.id)))
    .limit(1);
  if (!store) return Response.json({ error: 'not found' }, { status: 404 });
  if (store.status === 'building') return Response.json({ error: 'site is still building — try again once it is ready' }, { status: 409 });

  const body = (await req.json().catch(() => null)) as { domain?: string } | null;
  const domain = body?.domain ? normalizeDomain(body.domain) : '';
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return Response.json({ error: 'a valid domain is required' }, { status: 400 });

  try {
    const project = `store-${store.slug}`;
    const state = await attachDomain(project, domain);

    if (state.verified) {
      await db.update(schema.stores).set({ customDomain: domain, status: 'live' }).where(eq(schema.stores.id, store.id));
      return Response.json({ live: true, domain, url: `https://${domain}`, status: 'live' });
    }

    // Pending: the creator must add these records at their registrar, then call go-live again.
    return Response.json({ live: false, verified: false, domain, verification: state.verification ?? [], status: store.status });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'go-live failed' }, { status: 502 });
  }
}
