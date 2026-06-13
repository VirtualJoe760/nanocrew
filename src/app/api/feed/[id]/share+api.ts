import { eq, sql } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// POST /api/feed/:id/share — bump a product's share count (social proof). No auth:
// the native share sheet fires for anyone, signed in or not.
export async function POST(_req: Request, { id }: Record<string, string>) {
  try {
    const [row] = await db
      .update(schema.products)
      .set({ shareCount: sql`${schema.products.shareCount} + 1` })
      .where(eq(schema.products.id, id))
      .returning({ shareCount: schema.products.shareCount });
    return Response.json({ shareCount: row?.shareCount ?? 0 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
