import { and, desc, eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';

// GET /api/creator/products?storeSlug= — the creator's products for one of their stores,
// with whether each already has a feed video. Backs the composer's "Video ads" section.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const slug = new URL(req.url).searchParams.get('storeSlug');
  if (!slug) return Response.json({ error: 'storeSlug required' }, { status: 400 });
  try {
    const [store] = await db
      .select({ id: schema.stores.id })
      .from(schema.stores)
      .where(and(eq(schema.stores.slug, slug), eq(schema.stores.creatorId, user.id)))
      .limit(1);
    if (!store) return Response.json({ error: 'not found' }, { status: 404 });

    const products = await db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        imageUrl: schema.products.imageUrl,
        videoUrl: schema.products.videoUrl,
        isPublished: schema.products.isPublished,
      })
      .from(schema.products)
      .where(eq(schema.products.storeId, store.id))
      .orderBy(desc(schema.products.createdAt));
    return Response.json({ products });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
