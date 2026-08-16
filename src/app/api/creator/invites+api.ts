import { and, eq, sql } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';

// GET  /api/creator/invites — pending brand-collaboration invites FOR the signed-in creator (matched
//      on their email), joined with the brand + who invited them. Powers the Account page's
//      "You've been invited" section.
// POST /api/creator/invites { inviteId | token, action: 'accept' | 'decline' } — respond. Accepting
//      inserts the store_collaborators row (the ONLY thing tenant.ts reads — an invite never grants
//      access by itself). `token` is the email deep-link path; `inviteId` is the in-app list path.
//
// The invite's email must match the signed-in creator's email either way — possession of a token is
// not membership (a forwarded email must not let someone else into the brand). The mismatch error is
// distinct so the app can say "this invite was sent to a different address".

const inviteRow = {
  id: schema.storeInvites.id,
  role: schema.storeInvites.role,
  createdAt: schema.storeInvites.createdAt,
  expiresAt: schema.storeInvites.expiresAt,
  storeId: schema.storeInvites.storeId,
  storeName: schema.stores.name,
  storeSlug: schema.stores.slug,
  invitedByName: schema.creators.name,
  invitedByEmail: schema.creators.email,
};

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const email = (user.email ?? '').trim().toLowerCase();
  if (!email) return Response.json({ invites: [] });

  const invites = await db
    .select(inviteRow)
    .from(schema.storeInvites)
    .innerJoin(schema.stores, eq(schema.storeInvites.storeId, schema.stores.id))
    .innerJoin(schema.creators, eq(schema.storeInvites.invitedBy, schema.creators.id))
    .where(
      and(
        eq(schema.storeInvites.email, email),
        eq(schema.storeInvites.status, 'pending'),
        sql`${schema.storeInvites.expiresAt} > now()`,
      ),
    );
  return Response.json({ invites });
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const email = (user.email ?? '').trim().toLowerCase();

  const b = (await req.json().catch(() => null)) as
    | { inviteId?: string; token?: string; action?: 'accept' | 'decline' }
    | null;
  if (!b || (b.action !== 'accept' && b.action !== 'decline') || (!b.inviteId && !b.token)) {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }

  const [invite] = await db
    .select({
      id: schema.storeInvites.id,
      storeId: schema.storeInvites.storeId,
      email: schema.storeInvites.email,
      role: schema.storeInvites.role,
      status: schema.storeInvites.status,
      expiresAt: schema.storeInvites.expiresAt,
    })
    .from(schema.storeInvites)
    .where(b.inviteId ? eq(schema.storeInvites.id, b.inviteId) : eq(schema.storeInvites.token, b.token!))
    .limit(1);

  if (!invite || invite.status !== 'pending') return Response.json({ error: 'not found' }, { status: 404 });
  if (invite.expiresAt < new Date()) return Response.json({ error: 'invite expired — ask for a new one' }, { status: 410 });
  if (invite.email !== email) {
    return Response.json(
      { error: `This invite was sent to ${invite.email} — you're signed in as ${email || 'a different account'}.`, code: 'email_mismatch' },
      { status: 403 },
    );
  }

  if (b.action === 'decline') {
    await db
      .update(schema.storeInvites)
      .set({ status: 'declined', respondedAt: new Date() })
      .where(and(eq(schema.storeInvites.id, invite.id), eq(schema.storeInvites.status, 'pending')));
    return Response.json({ ok: true, declined: true });
  }

  // Accept: membership first, then settle the invite. onConflictDoNothing makes a double-accept
  // (two taps, webhook-less retry) land on the same row instead of erroring.
  await db
    .insert(schema.storeCollaborators)
    .values({ storeId: invite.storeId, creatorId: user.id, role: invite.role })
    .onConflictDoNothing();
  await db
    .update(schema.storeInvites)
    .set({ status: 'accepted', respondedAt: new Date() })
    .where(and(eq(schema.storeInvites.id, invite.id), eq(schema.storeInvites.status, 'pending')));

  const [store] = await db
    .select({ slug: schema.stores.slug, name: schema.stores.name })
    .from(schema.stores)
    .where(eq(schema.stores.id, invite.storeId))
    .limit(1);
  return Response.json({ ok: true, accepted: true, store });
}
