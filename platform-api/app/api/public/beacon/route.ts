import { eq, sql } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { corsJson, corsPreflight } from '@/lib/cors';

export const OPTIONS = corsPreflight;

// POST /api/public/beacon { storeSlug } — one pageview tick from a brand site.
// Daily-counter granularity; deliberately anonymous (no IPs, no paths, no cookies).
export async function POST(req: Request) {
  try {
    const { storeSlug } = (await req.json()) as { storeSlug?: string };
    if (!storeSlug) return corsJson({ ok: false }, { status: 400 });
    const [store] = await db
      .select({ id: schema.stores.id })
      .from(schema.stores)
      .where(eq(schema.stores.slug, storeSlug))
      .limit(1);
    if (!store) return corsJson({ ok: false }, { status: 404 });
    const day = new Date().toISOString().slice(0, 10);
    await db
      .insert(schema.pageViews)
      .values({ storeId: store.id, day, views: 1 })
      .onConflictDoUpdate({
        target: [schema.pageViews.storeId, schema.pageViews.day],
        set: { views: sql`${schema.pageViews.views} + 1` },
      });
    return corsJson({ ok: true });
  } catch {
    return corsJson({ ok: false }, { status: 500 });
  }
}
