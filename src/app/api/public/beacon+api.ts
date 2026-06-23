import { eq, sql } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// POST /api/public/beacon { storeSlug } — one pageview tick from a brand site.
// Daily-counter granularity; deliberately anonymous (no IPs, no paths, no cookies).
export async function POST(req: Request) {
  try {
    const { storeSlug } = (await req.json()) as { storeSlug?: string };
    if (!storeSlug) return Response.json({ ok: false }, { status: 400 });
    const [store] = await db
      .select({ id: schema.stores.id })
      .from(schema.stores)
      .where(eq(schema.stores.slug, storeSlug))
      .limit(1);
    if (!store) return Response.json({ ok: false }, { status: 404 });
    const day = new Date().toISOString().slice(0, 10);
    await db
      .insert(schema.pageViews)
      .values({ storeId: store.id, day, views: 1 })
      .onConflictDoUpdate({
        target: [schema.pageViews.storeId, schema.pageViews.day],
        set: { views: sql`${schema.pageViews.views} + 1` },
      });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
