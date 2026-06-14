import { and, eq } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { debitCredits, grant, InsufficientCreditsError } from '@/lib/credits';
import { attachDomain, buyDomain, domainCredits, normalizeDomain, searchDomain } from '@/lib/domains';
import { goLiveBlockReason } from '@/lib/connect';
import { getEntitlements } from '@/lib/billing';

// POST /api/creator/stores/:slug/domain/buy { domain } — buy a NEW domain and go live on it.
// Re-prices at purchase time, charges the creator in credits, buys it on Vercel, attaches it to the
// store's project, and flips the store to `live`. Credits are refunded if the purchase/attach fails.
// Needs the platform's Vercel billing + a domain-scoped VERCEL_TOKEN (Joe's config).
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

  // A domain points at a website, which is a Pro+ feature.
  const { website } = await getEntitlements(user.id);
  if (!website) return Response.json({ error: 'upgrade_required', feature: 'website' }, { status: 402 });

  // Connect gate (Phase D) — buying a domain also goes live, so the same payment-setup rule applies.
  const blocked = await goLiveBlockReason(user.id);
  if (blocked) return Response.json({ error: blocked, reason: 'connect_required' }, { status: 409 });

  const body = (await req.json().catch(() => null)) as { domain?: string } | null;
  const domain = body?.domain ? normalizeDomain(body.domain) : '';
  if (!/^[a-z0-9-]+\.[a-z]{2,}$/.test(domain)) return Response.json({ error: 'enter a domain like mybrand.com' }, { status: 400 });

  // Re-price at purchase time — never trust a client-sent price.
  let priceUsd: number;
  try {
    const offer = await searchDomain(domain);
    if (!offer.available) return Response.json({ error: 'that domain is no longer available' }, { status: 409 });
    if (offer.priceUsd == null) return Response.json({ error: 'that domain can’t be priced — try another' }, { status: 409 });
    priceUsd = offer.priceUsd;
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'pricing failed' }, { status: 502 });
  }
  const cost = domainCredits(priceUsd);

  try {
    await debitCredits(user.id, cost, 'domain', store.id);
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return Response.json({ error: 'insufficient_credits', needed: e.needed, balance: e.balance }, { status: 402 });
    }
    throw e;
  }

  // Buy first. Only a FAILED purchase refunds — once the domain is bought (real money spent on
  // Vercel) we never refund; if attaching lags behind registration we just retry / report pending.
  try {
    await buyDomain(domain, priceUsd);
  } catch (e) {
    await grant(user.id, cost, 'refund', store.id).catch(() => {});
    return Response.json({ error: e instanceof Error ? e.message : 'purchase failed — you were not charged' }, { status: 502 });
  }

  // Domain is ours now. Record it, then attach to the store project (registration can take a few
  // seconds, so retry). Going live == attached.
  await db.update(schema.stores).set({ customDomain: domain }).where(eq(schema.stores.id, store.id));
  const project = `store-${store.slug}`;
  for (let i = 0; i < 5; i++) {
    try {
      await attachDomain(project, domain);
      await db.update(schema.stores).set({ status: 'live' }).where(eq(schema.stores.id, store.id));
      return Response.json({ live: true, domain, url: `https://${domain}`, status: 'live', charged: cost });
    } catch {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  // Bought but not yet attachable — the creator re-opens go-live shortly to finish (no refund).
  return Response.json({ live: false, domain, status: store.status, charged: cost, note: 'Domain purchased — finishing registration. Re-open Go live in a minute to point your site at it.' }, { status: 202 });
}
