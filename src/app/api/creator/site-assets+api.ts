import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { revalidateStorefront } from '@/lib/storefront-revalidate';
import { TenantError, assertCatalogueOwner, storeForMember } from '@/lib/tenant';
import { deriveKit, type LogoKit } from '@/lib/logo-kit';

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
//   section:<key>             → stores.site_assets.sections[key] (a named in-page image the
//                               template renders, e.g. 'section:about' — the data-nano-image contract)
// 'logo' = the WORDMARK master; 'mark' = the square ICON master (app icon). Assigning either
// re-derives the full LogoKit (mono variants, app tile, touch icon, favicon) — lib/logo-kit.ts.
type Slot = 'hero' | 'heroVideo' | 'heroPoster' | 'logo' | 'mark' | 'cover' | 'og';
const SLOTS: Slot[] = ['hero', 'heroVideo', 'heroPoster', 'logo', 'mark', 'cover', 'og'];
const isSection = (s: string) => /^section:[a-z0-9_-]{1,40}$/i.test(s);

// GET /api/creator/site-assets?storeSlug=… — the CURRENT live assets, so surfaces (the Design
// tab's Site-assets dock, Eve's asset flow) can SHOW what's on the site (Joe, 2026-08-18: the
// dock said "No graphics yet" while the site plainly had a hero and logo).
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const slug = new URL(req.url).searchParams.get('storeSlug');
  if (!slug) return Response.json({ error: 'storeSlug required' }, { status: 400 });
  try {
    const owned = await storeForMember(slug, user.id);
    if (!owned) return Response.json({ error: 'not found' }, { status: 404 });
    const [store] = await db
      .select({
        logoUrl: schema.stores.logoUrl,
        logoKit: schema.stores.logoKit,
        designSystem: schema.stores.designSystem,
        siteAssets: schema.stores.siteAssets,
      })
      .from(schema.stores)
      .where(eq(schema.stores.id, owned.id))
      .limit(1);
    const sa = (store?.siteAssets ?? {}) as {
      hero?: { imageUrl?: string | null; videoUrl?: string | null; poster?: string | null };
      og?: string;
      sections?: Record<string, string>;
    };
    // Read-time derive for pre-kit brands: a stored wordmark still yields the square faces
    // (deriveKit is pure — nothing is persisted here).
    let kit = (store?.logoKit ?? null) as Partial<LogoKit> | null;
    if (!kit && store?.logoUrl) {
      const palette = ((store.designSystem ?? {}) as { palette?: { role?: string; hex?: string }[] }).palette;
      const bg = palette?.find((c) => (c.role ?? '').toLowerCase().includes('background'))?.hex ?? '#ffffff';
      kit = deriveKit(store.logoUrl, null, bg);
    }
    return Response.json({
      assets: {
        hero: sa.hero?.imageUrl ?? null,
        heroVideo: sa.hero?.videoUrl ?? null,
        og: sa.og ?? null,
        logo: store?.logoUrl ?? null,
        // The identity set (lib/logo-kit.ts): the two editable MASTERS + the derived square faces.
        logoKit: kit
          ? { wordmark: kit.wordmark ?? null, mark: kit.mark ?? null, appTile: kit.appTile ?? null, favicon: kit.favicon ?? null }
          : null,
        sections: sa.sections ?? {},
      },
    });
  } catch (e) {
    const status = e instanceof TenantError ? e.status : 500;
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status });
  }
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const b = (await req.json().catch(() => null)) as { catalogueId?: string; storeSlug?: string; slot?: string; url?: string } | null;
  const url = b?.url;
  if (!b?.slot || (!SLOTS.includes(b.slot as Slot) && !isSection(b.slot)) || (!b.catalogueId && !b.storeSlug)) {
    return Response.json({ error: 'a valid slot and either catalogueId or storeSlug are required' }, { status: 400 });
  }
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) {
    return Response.json({ error: 'a hosted https url is required' }, { status: 400 });
  }
  const slot = b.slot;
  if (slot === 'cover' && !b.catalogueId) {
    return Response.json({ error: 'cover needs a catalogueId' }, { status: 400 });
  }

  try {
    // Ownership: resolve the store from the catalogue (Design tab) OR the slug (the live-site editor).
    let storeId: string;
    if (b.catalogueId) {
      storeId = await assertCatalogueOwner(b.catalogueId, user.id);
    } else {
      const owned = await storeForMember(b.storeSlug!, user.id);
      if (!owned) return Response.json({ error: 'not found' }, { status: 404 });
      storeId = owned.id;
    }
    const [store] = await db
      .select({
        slug: schema.stores.slug,
        siteAssets: schema.stores.siteAssets,
        logoKit: schema.stores.logoKit,
        designSystem: schema.stores.designSystem,
      })
      .from(schema.stores)
      .where(eq(schema.stores.id, storeId))
      .limit(1);
    if (!store) return Response.json({ error: 'not found' }, { status: 404 });

    if (slot === 'logo' || slot === 'mark') {
      // A new MASTER re-derives the whole identity set (mono, app tile, touch icon, favicon) —
      // deterministic Cloudinary transforms, so the site's favicon/app icon follow automatically.
      const kit = (store.logoKit ?? {}) as Partial<LogoKit>;
      const wordmark = slot === 'logo' ? url : (kit.wordmark ?? null);
      const mark = slot === 'mark' ? url : (kit.mark ?? null);
      const palette = ((store.designSystem ?? {}) as { palette?: { role?: string; hex?: string }[] }).palette;
      const bg = palette?.find((c) => (c.role ?? '').toLowerCase().includes('background'))?.hex ?? '#ffffff';
      const next = deriveKit(wordmark, mark, bg);
      await db
        .update(schema.stores)
        .set({
          logoKit: next,
          ...(next.favicon ? { faviconUrl: next.favicon } : {}),
          ...(slot === 'logo' ? { logoUrl: url } : {}),
        })
        .where(eq(schema.stores.id, storeId));
    } else if (slot === 'cover') {
      await db.update(schema.catalogues).set({ coverImageUrl: url }).where(eq(schema.catalogues.id, b.catalogueId!));
    } else if (slot === 'og') {
      const current = (store.siteAssets ?? {}) as Record<string, unknown>;
      await db.update(schema.stores).set({ siteAssets: { ...current, og: url } }).where(eq(schema.stores.id, storeId));
    } else if (isSection(slot)) {
      // section:<key> → merge into site_assets.sections without clobbering the hero/og fields.
      const key = slot.slice('section:'.length);
      const current = (store.siteAssets ?? {}) as { sections?: Record<string, string> };
      const sections = { ...(current.sections ?? {}), [key]: url };
      await db.update(schema.stores).set({ siteAssets: { ...current, sections } }).where(eq(schema.stores.id, storeId));
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
    console.log(`[pipeline:site-assets] slug=${store.slug} slot=${slot} url=${String(url).slice(0, 60)}… (revalidating)`);
    return Response.json({ ok: true, slot });
  } catch (e) {
    const status = e instanceof TenantError ? e.status : 500;
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status });
  }
}
