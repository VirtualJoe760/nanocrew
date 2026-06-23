import { and, eq } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { getEntitlements } from '@/lib/billing';
import { notifyPlatform } from '@/lib/notify-internal';

// POST /api/creator/stores/:slug/publish { listed?: boolean } — open (or close) the brand's shop in
// the Nano Crew ecosystem. This is the APP-ONLY "go live": it lists the brand in the in-app Market
// AND on nanocrew.app/<slug> (both read `isPublic = true` + `status = 'live'`). It needs ONLY an
// active plan + at least one published product — NO website and NO custom domain. A custom domain /
// dedicated website stays a separate Pro upgrade (see go-live), layered on top; it is not required
// to sell. listed:false closes the shop (back to private/ready).
export async function POST(req: Request, { slug }: Record<string, string>) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const [store] = await db
    .select({ id: schema.stores.id, status: schema.stores.status, customDomain: schema.stores.customDomain, isPublic: schema.stores.isPublic })
    .from(schema.stores)
    .where(and(eq(schema.stores.slug, slug), eq(schema.stores.creatorId, user.id)))
    .limit(1);
  if (!store) return Response.json({ error: 'not found' }, { status: 404 });
  if (store.status === 'building') {
    return Response.json({ error: 'still building — try again once it is ready' }, { status: 409 });
  }

  const body = (await req.json().catch(() => null)) as { listed?: boolean } | null;
  const listed = body?.listed !== false; // default: open the shop

  if (listed) {
    // Selling in the ecosystem needs an active plan (Starter and up). No website entitlement needed.
    const { active } = await getEntitlements(user.id);
    if (!active) return Response.json({ error: 'subscription_required' }, { status: 402 });

    // Don't open an empty shop.
    const published = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(and(eq(schema.products.storeId, store.id), eq(schema.products.isPublished, true)))
      .limit(1);
    if (!published.length) return Response.json({ error: 'no_published_products' }, { status: 409 });

    await db.update(schema.stores).set({ isPublic: true, status: 'live' }).where(eq(schema.stores.id, store.id));
    // Congratulate the creator the FIRST time the shop opens (not on every re-toggle). Best-effort.
    if (!store.isPublic) await notifyPlatform({ action: 'brand_live', slug });
    return Response.json({ ok: true, listed: true, status: 'live' });
  }

  // Close the shop: hide from the marketplace. If it had a custom domain it stays attached; we just
  // drop it out of the public market by clearing isPublic and dropping back to 'ready'.
  await db
    .update(schema.stores)
    .set({ isPublic: false, status: store.customDomain ? 'live' : 'ready' })
    .where(eq(schema.stores.id, store.id));
  return Response.json({ ok: true, listed: false });
}
