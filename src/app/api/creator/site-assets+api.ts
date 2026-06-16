import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { revalidateStorefront } from '@/lib/storefront-revalidate';
import { TenantError, assertCatalogueOwner } from '@/lib/tenant';

// POST /api/creator/site-assets { catalogueId, slot, url } — assign a generated graphic (an
// already-hosted https url, e.g. an approved Design-tab graphic) to a website slot. This is the
// WRITE path that fills stores.site_assets (read by the storefront's /site-assets endpoint),
// the logo, or a catalogue cover — a direct DB write (not the forge), then revalidate the site.
//
// slot ∈ 'hero' | 'heroVideo' | 'heroPoster' | 'logo' | 'cover' | 'og'
//   hero/heroVideo/heroPoster → stores.site_assets.hero.{imageUrl,videoUrl,poster}
//   logo                      → stores.logo_url
//   cover                     → catalogues.cover_image_url (the given catalogue)
//   og                        → stores.site_assets.og (the social-share image; overrides the
//                               generated opengraph-image card on the storefront)
type Slot = 'hero' | 'heroVideo' | 'heroPoster' | 'logo' | 'cover' | 'og';
const SLOTS: Slot[] = ['hero', 'heroVideo', 'heroPoster', 'logo', 'cover', 'og'];

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const b = (await req.json().catch(() => null)) as { catalogueId?: string; slot?: string; url?: string } | null;
  const url = b?.url;
  if (!b?.catalogueId || !b.slot || !SLOTS.includes(b.slot as Slot)) {
    return Response.json({ error: 'catalogueId and a valid slot are required' }, { status: 400 });
  }
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) {
    return Response.json({ error: 'a hosted https url is required' }, { status: 400 });
  }
  const slot = b.slot as Slot;

  try {
    // Ownership: the catalogue (and thus its store) must belong to this creator.
    const storeId = await assertCatalogueOwner(b.catalogueId, user.id);
    const [store] = await db
      .select({ slug: schema.stores.slug, siteAssets: schema.stores.siteAssets })
      .from(schema.stores)
      .where(eq(schema.stores.id, storeId))
      .limit(1);
    if (!store) return Response.json({ error: 'not found' }, { status: 404 });

    if (slot === 'logo') {
      await db.update(schema.stores).set({ logoUrl: url }).where(eq(schema.stores.id, storeId));
    } else if (slot === 'cover') {
      await db.update(schema.catalogues).set({ coverImageUrl: url }).where(eq(schema.catalogues.id, b.catalogueId));
    } else if (slot === 'og') {
      const current = (store.siteAssets ?? {}) as Record<string, unknown>;
      await db.update(schema.stores).set({ siteAssets: { ...current, og: url } }).where(eq(schema.stores.id, storeId));
    } else {
      // Merge into site_assets.hero so we don't clobber the other hero fields.
      const current = (store.siteAssets ?? {}) as { hero?: Record<string, string | null>; sections?: Record<string, string> };
      const hero = { ...(current.hero ?? {}) };
      if (slot === 'hero') hero.imageUrl = url;
      if (slot === 'heroVideo') hero.videoUrl = url;
      if (slot === 'heroPoster') hero.poster = url;
      await db.update(schema.stores).set({ siteAssets: { ...current, hero } }).where(eq(schema.stores.id, storeId));
    }

    void revalidateStorefront(store.slug);
    return Response.json({ ok: true, slot });
  } catch (e) {
    const status = e instanceof TenantError ? e.status : 500;
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status });
  }
}
