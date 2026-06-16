import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { corsJson, corsPreflight } from '@/lib/cors';

export const OPTIONS = corsPreflight;

// GET /api/public/stores/:slug/site-assets — creator-generated WEBSITE graphics (hero media,
// section images) made in the Design tab. The storefront reads these and OVERRIDES its
// content/placeholders.json. Null/absent fields → the template keeps its brand-tinted placeholder.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const [store] = await db
      .select({ siteAssets: schema.stores.siteAssets })
      .from(schema.stores)
      .where(eq(schema.stores.slug, slug))
      .limit(1);
    if (!store) return corsJson({ error: 'store not found' }, { status: 404 });
    const assets = (store.siteAssets ?? {}) as { hero?: unknown; sections?: unknown };
    return corsJson({ hero: assets.hero ?? null, sections: assets.sections ?? {} });
  } catch (e) {
    return corsJson({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
