import { randomBytes } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { sendInviteEmail } from '@/lib/collab-invite';
import { corsJson, corsPreflight } from '@/lib/cors';
import { db, schema } from '@/lib/db';

export const OPTIONS = corsPreflight;
export const dynamic = 'force-dynamic';

// The WEB half of brand collaborators — the mirror of
// src/app/api/creator/stores/[slug]/collaborators+api.ts, which the site cannot call itself: the
// app's Cloud Run backend answers browsers with `Allow-Methods: GET, POST` only, so removing a
// collaborator (DELETE) dies at preflight.
//
// GET    — the store's collaborators + pending invites
// POST   { email } — invite by email. Consent-based: nobody joins a brand without accepting.
// DELETE { collaboratorId? | inviteId? } — remove a member, or revoke a pending invite.
//
// ALL OWNER-ONLY, deliberately not storeForMember. Collaborators design and manage the brand, but
// only the owner administers who belongs to it — otherwise an invited collaborator could remove the
// owner. Anyone else probing gets the same opaque 404 as a store that doesn't exist.

const INVITE_TTL_DAYS = 14;

async function resolveOwned(req: Request, slug: string) {
  const user = await getUserFromRequest(req);
  if (!user) return { res: corsJson({ error: 'unauthorized' }, { status: 401 }) };
  const [store] = await db
    .select({ id: schema.stores.id, name: schema.stores.name, creatorId: schema.stores.creatorId })
    .from(schema.stores)
    .where(and(eq(schema.stores.slug, slug), eq(schema.stores.creatorId, user.id)))
    .limit(1);
  if (!store) return { res: corsJson({ error: 'not found' }, { status: 404 }) };
  return { store };
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await resolveOwned(req, slug);
  if (r.res) return r.res;

  const collaborators = await db
    .select({
      id: schema.storeCollaborators.id,
      email: schema.creators.email,
      name: schema.creators.name,
      role: schema.storeCollaborators.role,
      createdAt: schema.storeCollaborators.createdAt,
    })
    .from(schema.storeCollaborators)
    .innerJoin(schema.creators, eq(schema.storeCollaborators.creatorId, schema.creators.id))
    .where(eq(schema.storeCollaborators.storeId, r.store.id));

  // Pending + unexpired only — accepted/declined history isn't a management surface.
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
        eq(schema.storeInvites.storeId, r.store.id),
        eq(schema.storeInvites.status, 'pending'),
        sql`${schema.storeInvites.expiresAt} > now()`,
      ),
    );

  return corsJson({ collaborators, invites });
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await resolveOwned(req, slug);
  if (r.res) return r.res;

  const b = (await req.json().catch(() => null)) as { email?: string } | null;
  const email = typeof b?.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return corsJson({ error: 'a valid email is required' }, { status: 400 });
  }

  // Already involved? Both the owner and an existing collaborator are 409s, not invites.
  const [existing] = await db
    .select({ id: schema.creators.id })
    .from(schema.creators)
    .where(sql`lower(${schema.creators.email}) = ${email}`)
    .limit(1);
  if (existing) {
    if (existing.id === r.store.creatorId) return corsJson({ error: 'That’s the brand owner.' }, { status: 409 });
    const [member] = await db
      .select({ id: schema.storeCollaborators.id })
      .from(schema.storeCollaborators)
      .where(and(eq(schema.storeCollaborators.storeId, r.store.id), eq(schema.storeCollaborators.creatorId, existing.id)))
      .limit(1);
    if (member) return corsJson({ error: 'They already collaborate on this brand.' }, { status: 409 });
  }

  // One live invite per store+email: re-inviting supersedes the old one (fresh token + clock)
  // instead of leaving several valid tokens for the same person.
  await db
    .update(schema.storeInvites)
    .set({ status: 'revoked', respondedAt: new Date() })
    .where(
      and(
        eq(schema.storeInvites.storeId, r.store.id),
        eq(schema.storeInvites.email, email),
        eq(schema.storeInvites.status, 'pending'),
      ),
    );

  const [invite] = await db
    .insert(schema.storeInvites)
    .values({
      storeId: r.store.id,
      email,
      token: randomBytes(24).toString('base64url'),
      invitedBy: r.store.creatorId,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    })
    .returning({
      id: schema.storeInvites.id,
      email: schema.storeInvites.email,
      role: schema.storeInvites.role,
      createdAt: schema.storeInvites.createdAt,
      expiresAt: schema.storeInvites.expiresAt,
    });

  // In-process here (Resend lives in this unit), so no internal round-trip is needed — but still
  // awaited, and never fatal: the invite exists and is acceptable even if the email fails.
  try {
    await sendInviteEmail(invite.id);
  } catch {
    /* the invite is written; a failed send is recoverable by re-inviting */
  }

  return corsJson({ invite });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await resolveOwned(req, slug);
  if (r.res) return r.res;

  const b = (await req.json().catch(() => null)) as { collaboratorId?: string; inviteId?: string } | null;

  if (b?.inviteId) {
    const revoked = await db
      .update(schema.storeInvites)
      .set({ status: 'revoked', respondedAt: new Date() })
      .where(
        and(
          eq(schema.storeInvites.id, b.inviteId),
          eq(schema.storeInvites.storeId, r.store.id),
          eq(schema.storeInvites.status, 'pending'),
        ),
      )
      .returning({ id: schema.storeInvites.id });
    if (!revoked.length) return corsJson({ error: 'not found' }, { status: 404 });
    return corsJson({ ok: true });
  }

  if (b?.collaboratorId) {
    // Scoped to THIS store so a collaborator id from another brand can't be removed through it.
    const removed = await db
      .delete(schema.storeCollaborators)
      .where(
        and(
          eq(schema.storeCollaborators.id, b.collaboratorId),
          eq(schema.storeCollaborators.storeId, r.store.id),
        ),
      )
      .returning({ id: schema.storeCollaborators.id });
    if (!removed.length) return corsJson({ error: 'not found' }, { status: 404 });
    return corsJson({ ok: true });
  }

  return corsJson({ error: 'invalid body' }, { status: 400 });
}
