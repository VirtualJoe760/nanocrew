import { eq } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { corsJson, corsPreflight } from '@/lib/cors';
import { db, schema } from '@/lib/db';
import { uniquePostSlug } from '@/lib/posts';
import { isStoreMember } from '@/lib/tenant';

export const OPTIONS = corsPreflight;

// Resolve a post the caller owns or collaborates on (post → store → member).
async function ownedPost(creatorId: string, postId: string) {
  const [row] = await db
    .select({
      id: schema.storePosts.id,
      storeId: schema.storePosts.storeId,
      slug: schema.storePosts.slug,
      isPublished: schema.storePosts.isPublished,
      publishedAt: schema.storePosts.publishedAt,
    })
    .from(schema.storePosts)
    .where(eq(schema.storePosts.id, postId))
    .limit(1);
  if (!row) return null;
  if (!(await isStoreMember(row.storeId, creatorId))) return null;
  return row;
}

// PATCH /api/creator/posts/:id — update any of title/excerpt/bodyMd/coverImageUrl/publish.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest(req);
  if (!user) return corsJson({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const existing = await ownedPost(user.id, id);
  if (!existing) return corsJson({ error: 'not found' }, { status: 404 });

  try {
    const b = (await req.json()) as {
      title?: string;
      excerpt?: string | null;
      bodyMd?: string;
      coverImageUrl?: string | null;
      publish?: boolean;
    };
    const set: Record<string, unknown> = {};
    if (typeof b.title === 'string' && b.title.trim()) {
      set.title = b.title.trim();
      set.slug = await uniquePostSlug(existing.storeId, b.title, id);
    }
    if (b.excerpt !== undefined) set.excerpt = b.excerpt?.toString().trim() || null;
    if (typeof b.bodyMd === 'string') set.bodyMd = b.bodyMd;
    if (b.coverImageUrl !== undefined) set.coverImageUrl = b.coverImageUrl?.toString().trim() || null;
    if (typeof b.publish === 'boolean') {
      set.isPublished = b.publish;
      // Stamp publishedAt on first publish; keep the original date afterwards.
      if (b.publish && !existing.publishedAt) set.publishedAt = new Date();
    }
    if (!Object.keys(set).length) return corsJson({ error: 'nothing to update' }, { status: 400 });

    const [post] = await db.update(schema.storePosts).set(set).where(eq(schema.storePosts.id, id)).returning();
    return corsJson({ post });
  } catch (e) {
    console.error('[creator/posts PATCH]', e instanceof Error ? e.message : e);
    return corsJson({ error: 'internal' }, { status: 500 });
  }
}

// DELETE /api/creator/posts/:id
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest(req);
  if (!user) return corsJson({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const existing = await ownedPost(user.id, id);
  if (!existing) return corsJson({ error: 'not found' }, { status: 404 });
  await db.delete(schema.storePosts).where(eq(schema.storePosts.id, id));
  return corsJson({ ok: true });
}
