import { randomBytes } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { notifyPlatform } from '@/lib/notify-internal';

// GET    /api/creator/stores/:slug/collaborators — the store's collaborators + pending invites.
// POST   /api/creator/stores/:slug/collaborators { email } — INVITE by email. Consent-based (Joe,
//        2026-08-16): nobody is added to a brand without accepting. The invitee gets a branded
//        email (via platform-api) and an in-app Accept on their Account page; they do NOT need a
//        Nano Crew account yet — the invite waits on their email.
// DELETE /api/creator/stores/:slug/collaborators { collaboratorId? | inviteId? } — remove a
//        collaborator, or revoke a pending invite.
//
// All OWNER-only: collaborators design + manage the store, but only the owner administers
// membership — so this deliberately does NOT use storeForMember. A collaborator (or stranger)
// probing the route gets the same opaque 404 as a store that doesn't exist.

const INVITE_TTL_DAYS = 14;

async function resolveOwned(req: Request, slug: string): Promise<{ id: string; name: string; creatorId: string } | Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const [store] = await db
    .select({ id: schema.stores.id, name: schema.stores.name, creatorId: schema.stores.creatorId })
    .from(schema.stores)
    .where(and(eq(schema.stores.slug, slug), eq(schema.stores.creatorId, user.id)))
    .limit(1);
  if (!store) return Response.json({ error: 'not found' }, { status: 404 });
  return store;
}

/** One collaborator row as the client sees it — collaborator id + who they are. */
const memberEntry = {
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
    .select(memberEntry)
    .from(schema.storeCollaborators)
    .innerJoin(schema.creators, eq(schema.storeCollaborators.creatorId, schema.creators.id))
    .where(eq(schema.storeCollaborators.storeId, r.id));

  // Pending, unexpired invites only — accepted/declined/revoked history isn't a management surface.
  const invites = await db
    .select({
      id: schema.storeInvites.id,
      email: schema.storeInvites.email,
      role: schema.storeInvites.role,
      createdAt: schema.storeInvites.createdAt,
      expiresAt: schema.storeInvites.expiresAt,
    })
    .from(schema.storeInvites)
    .where(
      and(
        eq(schema.storeInvites.storeId, r.id),
        eq(schema.storeInvites.status, 'pending'),
        sql`${schema.storeInvites.expiresAt} > now()`,
      ),
    );

  return Response.json({ collaborators, invites });
}

export async function POST(req: Request, { slug }: Record<string, string>) {
  const r = await resolveOwned(req, slug);
  if (r instanceof Response) return r;

  const b = (await req.json().catch(() => null)) as { email?: string } | null;
  const email = typeof b?.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ error: 'a valid email is required' }, { status: 400 });
  }

  // Already a member? Look up whether this email belongs to a creator who's the owner or already
  // collaborates — both are 409s, not invites.
  const [existing] = await db
    .select({ id: schema.creators.id })
    .from(schema.creators)
    .where(sql`lower(${schema.creators.email}) = ${email}`)
    .limit(1);
  if (existing) {
    if (existing.id === r.creatorId) return Response.json({ error: 'already the owner' }, { status: 409 });
    const [member] = await db
      .select({ id: schema.storeCollaborators.id })
      .from(schema.storeCollaborators)
      .where(and(eq(schema.storeCollaborators.storeId, r.id), eq(schema.storeCollaborators.creatorId, existing.id)))
      .limit(1);
    if (member) return Response.json({ error: 'already a collaborator' }, { status: 409 });
  }

  // One live invite per store+email: re-inviting supersedes the old one (fresh token + clock)
  // instead of accumulating parallel valid tokens for the same person.
  await db
    .update(schema.storeInvites)
    .set({ status: 'revoked', respondedAt: new Date() })
    .where(and(eq(schema.storeInvites.storeId, r.id), eq(schema.storeInvites.email, email), eq(schema.storeInvites.status, 'pending')));

  const [invite] = await db
    .insert(schema.storeInvites)
    .values({
      storeId: r.id,
      email,
      token: randomBytes(24).toString('base64url'),
      invitedBy: r.creatorId,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    })
    .returning({
      id: schema.storeInvites.id,
      email: schema.storeInvites.email,
      role: schema.storeInvites.role,
      createdAt: schema.storeInvites.createdAt,
      expiresAt: schema.storeInvites.expiresAt,
    });

  // The branded email rides platform-api (Resend lives only there). AWAITED, not fire-and-forget:
  // on Cloud Run the CPU can be frozen the moment the response returns, so a dangling fetch is
  // routinely killed before it ever leaves the box — the invite email simply never sent. The
  // helper never throws (best-effort inside), so awaiting costs one round-trip, not reliability.
  await notifyPlatform({ action: 'collab_invite', inviteId: invite.id });

  return Response.json({ invite });
}

export async function DELETE(req: Request, { slug }: Record<string, string>) {
  const r = await resolveOwned(req, slug);
  if (r instanceof Response) return r;

  const b = (await req.json().catch(() => null)) as { collaboratorId?: string; inviteId?: string } | null;

  if (b?.inviteId) {
    const revoked = await db
      .update(schema.storeInvites)
      .set({ status: 'revoked', respondedAt: new Date() })
      .where(and(eq(schema.storeInvites.id, b.inviteId), eq(schema.storeInvites.storeId, r.id), eq(schema.storeInvites.status, 'pending')))
      .returning({ id: schema.storeInvites.id });
    if (!revoked.length) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({ ok: true });
  }

  if (b?.collaboratorId) {
    // Scoped to this store so a collaborator id from another brand can't be removed through it.
    const removed = await db
      .delete(schema.storeCollaborators)
      .where(and(eq(schema.storeCollaborators.id, b.collaboratorId), eq(schema.storeCollaborators.storeId, r.id)))
      .returning({ id: schema.storeCollaborators.id });
    if (!removed.length) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({ ok: true });
  }

  return Response.json({ error: 'invalid body' }, { status: 400 });
}
