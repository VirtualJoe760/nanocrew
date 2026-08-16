import { and, eq, sql } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';

// GET    /api/creator/stores/:slug/collaborators — list the store's collaborators (the owner is
//        implicit and never listed — see the store_collaborators schema comment).
// POST   /api/creator/stores/:slug/collaborators { email } — invite an existing Nano Crew creator
//        by email as an 'admin' collaborator (same semantics as scripts/add-collaborator.mjs).
// DELETE /api/creator/stores/:slug/collaborators { collaboratorId } — remove one.
//
// All OWNER-only: collaborators design + manage the store, but only the owner administers
// membership — so this deliberately does NOT use storeForMember. A collaborator (or stranger)
// probing the route gets the same opaque 404 as a store that doesn't exist.

async function resolveOwned(req: Request, slug: string): Promise<{ id: string; creatorId: string } | Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const [store] = await db
    .select({ id: schema.stores.id, creatorId: schema.stores.creatorId })
    .from(schema.stores)
    .where(and(eq(schema.stores.slug, slug), eq(schema.stores.creatorId, user.id)))
    .limit(1);
  if (!store) return Response.json({ error: 'not found' }, { status: 404 });
  return store;
}

/** One collaborator row as the client sees it — collaborator id + who they are. */
const entry = {
  id: schema.storeCollaborators.id,
  email: schema.creators.email,
  name: schema.creators.name,
  role: schema.storeCollaborators.role,
  createdAt: schema.storeCollaborators.createdAt,
};

export async function GET(req: Request, { slug }: Record<string, string>) {
  const r = await resolveOwned(req, slug);
  if (r instanceof Response) return r;

  const collaborators = await db
    .select(entry)
    .from(schema.storeCollaborators)
    .innerJoin(schema.creators, eq(schema.storeCollaborators.creatorId, schema.creators.id))
    .where(eq(schema.storeCollaborators.storeId, r.id));
  return Response.json({ collaborators });
}

export async function POST(req: Request, { slug }: Record<string, string>) {
  const r = await resolveOwned(req, slug);
  if (r instanceof Response) return r;

  const b = (await req.json().catch(() => null)) as { email?: string } | null;
  const email = typeof b?.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!email) return Response.json({ error: 'invalid body' }, { status: 400 });

  // The invitee must already have a Nano Crew account — collaborator rows key on creators.id, so
  // there's nothing to link until they've signed up.
  const [creator] = await db
    .select({ id: schema.creators.id })
    .from(schema.creators)
    .where(sql`lower(${schema.creators.email}) = ${email}`)
    .limit(1);
  if (!creator) {
    return Response.json(
      { error: 'No Nano Crew account for that email yet — have them sign up first, then add them.' },
      { status: 404 },
    );
  }
  if (creator.id === r.creatorId) {
    return Response.json({ error: 'already the owner' }, { status: 409 });
  }

  // onConflictDoNothing makes a re-invite idempotent (unique on store + creator); on conflict
  // .returning() is empty, so fall back to the existing row to answer with the same shape.
  const [inserted] = await db
    .insert(schema.storeCollaborators)
    .values({ storeId: r.id, creatorId: creator.id, role: 'admin' })
    .onConflictDoNothing()
    .returning({ id: schema.storeCollaborators.id });
  const rowId =
    inserted?.id ??
    (
      await db
        .select({ id: schema.storeCollaborators.id })
        .from(schema.storeCollaborators)
        .where(and(eq(schema.storeCollaborators.storeId, r.id), eq(schema.storeCollaborators.creatorId, creator.id)))
        .limit(1)
    )[0]?.id;
  if (!rowId) return Response.json({ error: 'could not add collaborator' }, { status: 500 });

  const [collaborator] = await db
    .select(entry)
    .from(schema.storeCollaborators)
    .innerJoin(schema.creators, eq(schema.storeCollaborators.creatorId, schema.creators.id))
    .where(eq(schema.storeCollaborators.id, rowId))
    .limit(1);
  return Response.json({ collaborator });
}

export async function DELETE(req: Request, { slug }: Record<string, string>) {
  const r = await resolveOwned(req, slug);
  if (r instanceof Response) return r;

  const b = (await req.json().catch(() => null)) as { collaboratorId?: string } | null;
  if (!b?.collaboratorId) return Response.json({ error: 'invalid body' }, { status: 400 });

  // Scoped to this store so a collaborator id from another brand can't be removed through it.
  const removed = await db
    .delete(schema.storeCollaborators)
    .where(and(eq(schema.storeCollaborators.id, b.collaboratorId), eq(schema.storeCollaborators.storeId, r.id)))
    .returning({ id: schema.storeCollaborators.id });
  if (!removed.length) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json({ ok: true });
}
