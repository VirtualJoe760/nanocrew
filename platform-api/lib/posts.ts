import { and, eq, ne } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { storeForMember } from '@/lib/tenant';

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

/** The creator must own or collaborate on the store. Returns the store id or null. */
export async function ownedStoreId(creatorId: string, storeSlug: string): Promise<string | null> {
  const store = await storeForMember(storeSlug, creatorId);
  return store?.id ?? null;
}

/** Unique slug within a store, avoiding an optional existing post id. */
export async function uniquePostSlug(storeId: string, base: string, exceptId?: string): Promise<string> {
  let slug = slugify(base);
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
    slug = `${slugify(base)}-${n}`;
  }
}
