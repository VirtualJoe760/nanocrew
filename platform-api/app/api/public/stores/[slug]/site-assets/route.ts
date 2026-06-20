import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { corsJson, corsPreflight } from '@/lib/cors';

export const OPTIONS = corsPreflight;

// GET /api/public/stores/:slug/site-assets — creator-generated WEBSITE graphics (logo, hero media,
// section images) made in the Design tab. The storefront reads these and OVERRIDES its baked
// brand.json / content/placeholders.json. Null/absent fields → the template keeps its baked value.
//   logo → stores.logo_url (a top-level column, set by Design tab "Set as logo" / brand creation)
//   hero/sections/og → stores.site_assets (jsonb)
// This is what lets EVERY asset assigned in the Design tab apply to the live site with no rebuild.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const [store] = await db
      .select({ siteAssets: schema.stores.siteAssets, logoUrl: schema.stores.logoUrl })
      .from(schema.stores)
      .where(eq(schema.stores.slug, slug))
      .limit(1);
    if (!store) return corsJson({ error: 'store not found' }, { status: 404 });
    const assets = (store.siteAssets ?? {}) as { hero?: unknown; sections?: unknown; og?: unknown };
    return corsJson({
      logo: store.logoUrl || null,
      hero: assets.hero ?? null,
      sections: assets.sections ?? {},
      og: assets.og ?? null,
    });
  } catch (e) {
    return corsJson({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
