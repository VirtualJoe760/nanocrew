import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { corsJson, corsPreflight } from '@/lib/cors';

export const OPTIONS = corsPreflight;

// GET /api/public/stores/:slug — live brand facts. Lets sites pick up a rebrand
// (new logo, new display name) without a redeploy: templates may overlay this
// onto their baked-in brand.json.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const [store] = await db
      .select({
        slug: schema.stores.slug,
        name: schema.stores.name,
        tagline: schema.stores.tagline,
        logoUrl: schema.stores.logoUrl,
        faviconUrl: schema.stores.faviconUrl,
        // Whether the brand is listed/shoppable in the ecosystem (in-app Market + nanocrew.app/<slug>).
        isPublic: schema.stores.isPublic,
        status: schema.stores.status,
      })
      .from(schema.stores)
      .where(eq(schema.stores.slug, slug))
      .limit(1);
    if (!store) return corsJson({ error: 'store not found' }, { status: 404 });
    return corsJson({ store }, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch (e) {
    console.error('[public/store]', e instanceof Error ? e.message : e);
    return corsJson({ error: 'internal' }, { status: 500 });
  }
}
