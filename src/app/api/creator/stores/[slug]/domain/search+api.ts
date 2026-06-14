import { and, eq } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { domainCredits, normalizeDomain, searchDomain } from '@/lib/domains';

// GET /api/creator/stores/:slug/domain/search?q=name.com — is this domain available to buy, and
// for how much (price in USD + the credits we'd charge)? Read-only — no purchase, no charge.
export async function GET(req: Request, { slug }: Record<string, string>) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // Ownership check (keeps the Vercel token behind the creator's own store).
  const [store] = await db
    .select({ id: schema.stores.id })
    .from(schema.stores)
    .where(and(eq(schema.stores.slug, slug), eq(schema.stores.creatorId, user.id)))
    .limit(1);
  if (!store) return Response.json({ error: 'not found' }, { status: 404 });

  const q = new URL(req.url).searchParams.get('q') ?? '';
  const domain = normalizeDomain(q);
  if (!/^[a-z0-9-]+\.[a-z]{2,}$/.test(domain)) return Response.json({ error: 'enter a domain like mybrand.com' }, { status: 400 });

  try {
    const offer = await searchDomain(domain);
    const credits = offer.priceUsd != null ? domainCredits(offer.priceUsd) : null;
    return Response.json({ ...offer, credits });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'search failed' }, { status: 502 });
  }
}
