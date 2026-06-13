import { and, eq } from 'drizzle-orm';

import { corsJson, corsPreflight } from '@/lib/cors';
import { db, schema } from '@/lib/db';

export const OPTIONS = corsPreflight;

// GET /api/public/stores/:slug/posts/:postSlug — one published post with body.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; postSlug: string }> }) {
  const { slug, postSlug } = await params;
  try {
    const [store] = await db
      .select({ id: schema.stores.id })
      .from(schema.stores)
      .where(eq(schema.stores.slug, slug))
      .limit(1);
    if (!store) return corsJson({ error: 'store not found' }, { status: 404 });

    const [post] = await db
      .select({
        slug: schema.storePosts.slug,
        title: schema.storePosts.title,
        excerpt: schema.storePosts.excerpt,
        bodyMd: schema.storePosts.bodyMd,
        coverImageUrl: schema.storePosts.coverImageUrl,
        publishedAt: schema.storePosts.publishedAt,
      })
      .from(schema.storePosts)
      .where(
        and(
          eq(schema.storePosts.storeId, store.id),
          eq(schema.storePosts.slug, postSlug),
          eq(schema.storePosts.isPublished, true),
        ),
      )
      .limit(1);
    if (!post) return corsJson({ error: 'post not found' }, { status: 404 });

    return corsJson({ post }, { headers: { 'Cache-Control': 'public, max-age=120' } });
  } catch (e) {
    console.error('[public/post]', e instanceof Error ? e.message : e);
    return corsJson({ error: 'internal' }, { status: 500 });
  }
}
