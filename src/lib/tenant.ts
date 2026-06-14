import { and, asc, eq, inArray } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// Multi-tenant scoping for the Designer + creator endpoints. A store is accessible to a creator if
// they OWN it (stores.creatorId) or COLLABORATE on it (store_collaborators). These helpers resolve
// the store and assert membership, throwing a TenantError (with an HTTP status) on a miss/non-member.

export class TenantError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'TenantError';
  }
}

/** True if the user is listed as a collaborator on the store (owner is checked separately). */
async function isCollaborator(storeId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.storeCollaborators.id })
    .from(schema.storeCollaborators)
    .where(and(eq(schema.storeCollaborators.storeId, storeId), eq(schema.storeCollaborators.creatorId, userId)))
    .limit(1);
  return !!row;
}

/** True if the user owns OR collaborates on the store (membership by store id). */
export async function isStoreMember(storeId: string, userId: string): Promise<boolean> {
  const [own] = await db
    .select({ id: schema.stores.id })
    .from(schema.stores)
    .where(and(eq(schema.stores.id, storeId), eq(schema.stores.creatorId, userId)))
    .limit(1);
  if (own) return true;
  return isCollaborator(storeId, userId);
}

/** All store ids the user can act on: ones they own + ones they collaborate on. */
export async function accessibleStoreIds(userId: string): Promise<string[]> {
  const own = await db.select({ id: schema.stores.id }).from(schema.stores).where(eq(schema.stores.creatorId, userId));
  const collab = await db
    .select({ id: schema.storeCollaborators.storeId })
    .from(schema.storeCollaborators)
    .where(eq(schema.storeCollaborators.creatorId, userId));
  return [...new Set([...own.map((r) => r.id), ...collab.map((r) => r.id)])];
}

/** Resolve a store by slug IF the user owns or collaborates on it, else null. */
export async function storeForMember(
  slug: string,
  userId: string,
): Promise<{ id: string; slug: string; creatorId: string } | null> {
  const [store] = await db
    .select({ id: schema.stores.id, slug: schema.stores.slug, creatorId: schema.stores.creatorId })
    .from(schema.stores)
    .where(eq(schema.stores.slug, slug))
    .limit(1);
  if (!store) return null;
  if (store.creatorId === userId) return store;
  return (await isCollaborator(store.id, userId)) ? store : null;
}

/** The signed-in creator's primary store — owned first, else one they collaborate on. */
export async function getCreatorStore(userId: string): Promise<{ id: string; slug: string }> {
  const ids = await accessibleStoreIds(userId);
  if (!ids.length) throw new TenantError('no store for this creator', 404);
  const [row] = await db
    .select({ id: schema.stores.id, slug: schema.stores.slug })
    .from(schema.stores)
    .where(inArray(schema.stores.id, ids))
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
  if (row.creatorId !== userId && !(await isCollaborator(row.storeId, userId))) throw new TenantError('forbidden', 403);
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
  if (row.creatorId !== userId && !(await isCollaborator(row.storeId, userId))) throw new TenantError('forbidden', 403);
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
  if (row.creatorId !== userId && !(await isCollaborator(row.storeId, userId))) throw new TenantError('forbidden', 403);
  return row.storeId;
}
