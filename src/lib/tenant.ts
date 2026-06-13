import { asc, eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// Multi-tenant scoping for the Designer. Every designer endpoint authenticates the creator
// and resolves data through THEIR store — these helpers both resolve the store id and
// assert ownership, throwing a TenantError (with an HTTP status) on a miss or a non-owner.

export class TenantError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'TenantError';
  }
}

/** The signed-in creator's primary store — the Designer works on one store at a time. */
export async function getCreatorStore(userId: string): Promise<{ id: string; slug: string }> {
  const [row] = await db
    .select({ id: schema.stores.id, slug: schema.stores.slug })
    .from(schema.stores)
    .where(eq(schema.stores.creatorId, userId))
    .orderBy(asc(schema.stores.createdAt))
    .limit(1);
  if (!row) throw new TenantError('no store for this creator', 404);
  return row;
}

/** Resolve a catalogue's store, asserting the creator owns it. Returns the store id. */
export async function assertCatalogueOwner(catalogueId: string, userId: string): Promise<string> {
  const [row] = await db
    .select({ storeId: schema.catalogues.storeId, creatorId: schema.stores.creatorId })
    .from(schema.catalogues)
    .innerJoin(schema.stores, eq(schema.catalogues.storeId, schema.stores.id))
    .where(eq(schema.catalogues.id, catalogueId))
    .limit(1);
  if (!row) throw new TenantError('catalogue not found', 404);
  if (row.creatorId !== userId) throw new TenantError('forbidden', 403);
  return row.storeId;
}

/** Resolve a composition's store, asserting the creator owns it. Returns the store id. */
export async function assertCompositionOwner(compositionId: string, userId: string): Promise<string> {
  const [row] = await db
    .select({ storeId: schema.compositions.storeId, creatorId: schema.stores.creatorId })
    .from(schema.compositions)
    .innerJoin(schema.stores, eq(schema.compositions.storeId, schema.stores.id))
    .where(eq(schema.compositions.id, compositionId))
    .limit(1);
  if (!row) throw new TenantError('composition not found', 404);
  if (row.creatorId !== userId) throw new TenantError('forbidden', 403);
  return row.storeId;
}

/** Resolve a design's store, asserting the creator owns it. Returns the store id. */
export async function assertDesignOwner(designId: string, userId: string): Promise<string> {
  const [row] = await db
    .select({ storeId: schema.designs.storeId, creatorId: schema.stores.creatorId })
    .from(schema.designs)
    .innerJoin(schema.stores, eq(schema.designs.storeId, schema.stores.id))
    .where(eq(schema.designs.id, designId))
    .limit(1);
  if (!row) throw new TenantError('design not found', 404);
  if (row.creatorId !== userId) throw new TenantError('forbidden', 403);
  return row.storeId;
}
