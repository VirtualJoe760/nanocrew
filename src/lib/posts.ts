import { and, eq, ne } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// Shared helpers for journal posts (store_posts), used by the creator API routes
// the Studio composer and the brand-site /admin both call.

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'post'
  );
}

/** The store must belong to the creator. Returns the store id or null. */
export async function ownedStoreId(creatorId: string, storeSlug: string): Promise<string | null> {
  const [store] = await db
    .select({ id: schema.stores.id })
    .from(schema.stores)
    .where(and(eq(schema.stores.slug, storeSlug), eq(schema.stores.creatorId, creatorId)))
    .limit(1);
  return store?.id ?? null;
}

/** Unique slug within a store, avoiding an optional existing post id. */
export async function uniquePostSlug(storeId: string, base: string, exceptId?: string): Promise<string> {
  const root = slugify(base);
  let slug = root;
  for (let n = 2; ; n++) {
    const clash = await db
      .select({ id: schema.storePosts.id })
      .from(schema.storePosts)
      .where(
        and(
          eq(schema.storePosts.storeId, storeId),
          eq(schema.storePosts.slug, slug),
          exceptId ? ne(schema.storePosts.id, exceptId) : undefined,
        ),
      )
      .limit(1);
    if (!clash.length) return slug;
    slug = `${root}-${n}`;
  }
}
