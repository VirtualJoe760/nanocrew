import { and, desc, eq } from 'drizzle-orm';

import { corsJson, corsPreflight } from '@/lib/cors';
import { db, schema } from '@/lib/db';

export const OPTIONS = corsPreflight;

// GET /api/public/stores/:slug/posts — published journal posts, newest first.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const [store] = await db
      .select({ id: schema.stores.id })
      .from(schema.stores)
      .where(eq(schema.stores.slug, slug))
      .limit(1);
    if (!store) return corsJson({ error: 'store not found' }, { status: 404 });

    const posts = await db
      .select({
        slug: schema.storePosts.slug,
        title: schema.storePosts.title,
        excerpt: schema.storePosts.excerpt,
        coverImageUrl: schema.storePosts.coverImageUrl,
        publishedAt: schema.storePosts.publishedAt,
      })
      .from(schema.storePosts)
      .where(and(eq(schema.storePosts.storeId, store.id), eq(schema.storePosts.isPublished, true)))
      .orderBy(desc(schema.storePosts.publishedAt));

    return corsJson({ posts }, { headers: { 'Cache-Control': 'public, max-age=120' } });
  } catch (e) {
    console.error('[public/posts]', e instanceof Error ? e.message : e);
    return corsJson({ error: 'internal' }, { status: 500 });
  }
}
