import { and, asc, eq, sql } from 'drizzle-orm';

import { corsJson, corsPreflight } from '@/lib/cors';
import { db, schema } from '@/lib/db';

export const OPTIONS = corsPreflight;

// GET /api/public/stores/:slug/collections — the store's collections/drops (catalogues)
// that have at least one published product, newest-by-sort first, with a product count.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const [store] = await db
      .select({ id: schema.stores.id })
      .from(schema.stores)
      .where(eq(schema.stores.slug, slug))
      .limit(1);
    if (!store) return corsJson({ error: 'store not found' }, { status: 404 });

    const rows = await db
      .select({
        slug: schema.catalogues.slug,
        name: schema.catalogues.name,
        season: schema.catalogues.season,
        coverImageUrl: schema.catalogues.coverImageUrl,
        sortOrder: schema.catalogues.sortOrder,
        count: sql<number>`count(${schema.products.id})`.mapWith(Number),
      })
      .from(schema.catalogues)
      .innerJoin(
        schema.products,
        and(eq(schema.products.catalogueId, schema.catalogues.id), eq(schema.products.isPublished, true)),
      )
      .where(and(eq(schema.catalogues.storeId, store.id), eq(schema.catalogues.isActive, true)))
      .groupBy(schema.catalogues.slug, schema.catalogues.name, schema.catalogues.season, schema.catalogues.coverImageUrl, schema.catalogues.sortOrder)
      .orderBy(asc(schema.catalogues.sortOrder));

    return corsJson({ collections: rows }, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch (e) {
    console.error('[public/collections]', e instanceof Error ? e.message : e);
    return corsJson({ error: 'internal' }, { status: 500 });
  }
}
