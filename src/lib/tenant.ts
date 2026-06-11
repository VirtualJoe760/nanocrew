import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// Until Supabase Auth lands (task #5), all designer data hangs off the bootstrap
// "Nanocrew HQ" store. Auth will replace this with the signed-in creator's store.
const DEFAULT_STORE_SLUG = 'nanocrew';

let cached: { id: string } | null = null;

export async function getDefaultStore(): Promise<{ id: string }> {
  if (cached) return cached;
  const rows = await db
    .select({ id: schema.stores.id })
    .from(schema.stores)
    .where(eq(schema.stores.slug, DEFAULT_STORE_SLUG))
    .limit(1);
  if (!rows.length) throw new Error('Default store missing — run the seed');
  cached = rows[0];
  return cached;
}

// The correct multi-tenant scoping: a catalogue belongs to exactly one store.
export async function getStoreIdForCatalogue(catalogueId: string): Promise<string> {
  const rows = await db
    .select({ storeId: schema.catalogues.storeId })
    .from(schema.catalogues)
    .where(eq(schema.catalogues.id, catalogueId))
    .limit(1);
  if (!rows.length) throw new Error('Catalogue not found');
  return rows[0].storeId;
}
