import { eq } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { isStoreMember } from '@/lib/tenant';
import { uniquePostSlug } from '@/lib/posts';

async function ownedPost(creatorId: string, postId: string) {
  const [row] = await db
    .select({
      id: schema.storePosts.id,
      storeId: schema.storePosts.storeId,
      publishedAt: schema.storePosts.publishedAt,
    })
    .from(schema.storePosts)
    .where(eq(schema.storePosts.id, postId))
    .limit(1);
  if (!row) return null;
  if (!(await isStoreMember(row.storeId, creatorId))) return null;
  return row;
}

// PATCH /api/creator/posts/:id — update title/excerpt/bodyMd/coverImageUrl/publish.
export async function PATCH(req: Request, { id }: Record<string, string>) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const existing = await ownedPost(user.id, id);
  if (!existing) return Response.json({ error: 'not found' }, { status: 404 });
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
      if (b.publish && !existing.publishedAt) set.publishedAt = new Date();
    }
    if (!Object.keys(set).length) return Response.json({ error: 'nothing to update' }, { status: 400 });
    const [post] = await db.update(schema.storePosts).set(set).where(eq(schema.storePosts.id, id)).returning();
    return Response.json({ post });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}

// DELETE /api/creator/posts/:id
export async function DELETE(req: Request, { id }: Record<string, string>) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const existing = await ownedPost(user.id, id);
  if (!existing) return Response.json({ error: 'not found' }, { status: 404 });
  await db.delete(schema.storePosts).where(eq(schema.storePosts.id, id));
  return Response.json({ ok: true });
}
