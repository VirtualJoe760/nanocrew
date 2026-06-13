import { and, eq, sql } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';

// POST /api/feed/:id/like — toggle the signed-in viewer's like on a product.
// A free account is enough; returns the new { liked, likeCount }.
export async function POST(req: Request, { id }: Record<string, string>) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'sign in to like' }, { status: 401 });
  try {
    const [existing] = await db
      .select({ id: schema.productLikes.id })
      .from(schema.productLikes)
      .where(and(eq(schema.productLikes.productId, id), eq(schema.productLikes.userId, user.id)))
      .limit(1);

    let liked: boolean;
    if (existing) {
      await db.delete(schema.productLikes).where(eq(schema.productLikes.id, existing.id));
      liked = false;
    } else {
      await db
        .insert(schema.productLikes)
        .values({ productId: id, userId: user.id })
        .onConflictDoNothing();
      liked = true;
    }
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.productLikes)
      .where(eq(schema.productLikes.productId, id));
    return Response.json({ liked, likeCount: count });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
