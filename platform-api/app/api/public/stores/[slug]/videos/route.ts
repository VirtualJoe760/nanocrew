import { and, asc, eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { corsJson, corsPreflight } from '@/lib/cors';

export const OPTIONS = corsPreflight;

// GET /api/public/stores/:slug/videos — the store's featured on-model video wall: every
// published product's Veo on-model films, flattened newest-first, each carrying its product
// for a "shop this look" link + a poster. Backs the templates' homepage VideoGallery block.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const [store] = await db
      .select({ id: schema.stores.id })
      .from(schema.stores)
      .where(eq(schema.stores.slug, slug))
      .limit(1);
    if (!store) return corsJson({ error: 'store not found' }, { status: 404 });

    const rows = await db
      .select({
        slug: schema.products.slug,
        name: schema.products.name,
        imageUrl: schema.products.imageUrl,
        modelVideos: schema.products.modelVideos,
      })
      .from(schema.products)
      .where(and(eq(schema.products.storeId, store.id), eq(schema.products.isPublished, true)))
      .orderBy(asc(schema.products.createdAt));

    type Video = { src: string; poster: string | null; productSlug: string; productName: string };
    const videos: Video[] = [];
    for (const r of rows) {
      for (const src of r.modelVideos ?? []) {
        videos.push({ src, poster: r.imageUrl, productSlug: r.slug, productName: r.name });
      }
    }
    return corsJson({ videos }, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch (e) {
    console.error('[public/videos]', e instanceof Error ? e.message : e);
    return corsJson({ error: 'internal' }, { status: 500 });
  }
}
