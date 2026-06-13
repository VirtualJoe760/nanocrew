import { desc, eq } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { ownedStoreId, uniquePostSlug } from '@/lib/posts';

// GET /api/creator/posts?storeSlug=… — every post (incl drafts) for an owned store.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const storeSlug = new URL(req.url).searchParams.get('storeSlug');
  if (!storeSlug) return Response.json({ error: 'storeSlug required' }, { status: 400 });
  const storeId = await ownedStoreId(user.id, storeSlug);
  if (!storeId) return Response.json({ error: 'not found' }, { status: 404 });

  const posts = await db
    .select()
    .from(schema.storePosts)
    .where(eq(schema.storePosts.storeId, storeId))
    .orderBy(desc(schema.storePosts.updatedAt));
  return Response.json({ posts });
}

// POST /api/creator/posts { storeSlug, title, excerpt?, bodyMd?, coverImageUrl?, publish? }
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const b = (await req.json()) as {
      storeSlug?: string;
      title?: string;
      excerpt?: string;
      bodyMd?: string;
      coverImageUrl?: string;
      publish?: boolean;
    };
    if (!b.storeSlug || !b.title?.trim()) return Response.json({ error: 'storeSlug and title required' }, { status: 400 });
    const storeId = await ownedStoreId(user.id, b.storeSlug);
    if (!storeId) return Response.json({ error: 'not found' }, { status: 404 });

    const slug = await uniquePostSlug(storeId, b.title);
    const [post] = await db
      .insert(schema.storePosts)
      .values({
        storeId,
        slug,
        title: b.title.trim(),
        excerpt: b.excerpt?.trim() || null,
        bodyMd: b.bodyMd ?? '',
        coverImageUrl: b.coverImageUrl?.trim() || null,
        isPublished: !!b.publish,
        publishedAt: b.publish ? new Date() : null,
      })
      .returning();
    return Response.json({ post });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
