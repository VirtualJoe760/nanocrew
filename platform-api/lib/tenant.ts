import { and, eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// Multi-tenant scoping for the public-API creator endpoints. A store is accessible to a creator if
// they OWN it (stores.creatorId) or COLLABORATE on it (store_collaborators). Mirror of
// src/lib/tenant.ts in the app repo.

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
