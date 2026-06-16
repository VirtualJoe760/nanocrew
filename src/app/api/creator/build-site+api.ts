import { and, eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { provisionStorefront } from '@/lib/provision';
import { getEntitlements } from '@/lib/billing';
import type { BrandResult, ChatMessage } from '@/lib/interview';

// POST /api/creator/build-site { storeSlug } — provision a website for an existing brand
// that doesn't have one yet (e.g. it launched shop-only on Starter). A website is a Pro+ feature.
// Rebuilds the BrandResult from the stored profile + design system and fires the forge pipeline.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { storeSlug?: string } | null;
  if (!body?.storeSlug) return Response.json({ error: 'storeSlug required' }, { status: 400 });

  // Website is Pro and up — Starter brands sell in the app only.
  const { website } = await getEntitlements(user.id);
  if (!website) return Response.json({ error: 'upgrade_required', feature: 'website' }, { status: 402 });

  try {
    const [store] = await db
      .select()
      .from(schema.stores)
      .where(and(eq(schema.stores.slug, body.storeSlug), eq(schema.stores.creatorId, user.id)))
      .limit(1);
    if (!store) return Response.json({ error: 'not found' }, { status: 404 });
    if (store.deploymentUrl && !store.deploymentUrl.includes('github.com')) {
      return Response.json({ error: 'site_exists', deploymentUrl: store.deploymentUrl }, { status: 409 });
    }
    // The whole pipeline (brand.json + the brief) is built from the brand's design system — with no
    // palette/typography there is literally nothing to provision, and firing it would throw silently
    // inside the fire-and-forget provision and leave the store flapping back to 'ready' (the
    // Nano Crew HQ case). Refuse up front with a clear reason instead.
    if (!store.designSystem) {
      return Response.json({ error: 'no_design_system' }, { status: 422 });
    }

    // brand_profile was stored as { ...brandResult-without-designSystem, transcript }.
    const profile = (store.brandProfile ?? {}) as Record<string, unknown> & { transcript?: ChatMessage[] };
    const { transcript = [], ...rest } = profile;
    const brand = {
      ...rest,
      name: store.name,
      tagline: store.tagline ?? rest.tagline,
      story: store.descriptionMd ?? rest.story,
      designSystem: store.designSystem,
    } as unknown as BrandResult;

    await db.update(schema.stores).set({ status: 'building' }).where(eq(schema.stores.id, store.id));
    void provisionStorefront({ storeId: store.id, slug: store.slug, brand, logoUrl: store.logoUrl, transcript });

    return Response.json({ ok: true, status: 'building' });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
