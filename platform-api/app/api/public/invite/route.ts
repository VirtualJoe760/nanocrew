import { and, eq } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { corsJson, corsPreflight } from '@/lib/cors';
import { db, schema } from '@/lib/db';

export const OPTIONS = corsPreflight;

// POST /api/public/invite { token, action: 'accept' | 'decline' } — the WEB half of collaboration
// invites (Joe, 2026-08-16: a laptop can't open nanocrew://, so desktop email clicks route here and
// the database is updated on the web). Auth: a Supabase bearer minted by the invite page's own
// login/signup form. Mirrors the app route (src/app/api/creator/invites+api.ts) exactly:
//  - the invite's email must match the signed-in email (403 email_mismatch — a forwarded link
//    must not let someone else into the brand);
//  - accept inserts store_collaborators, the ONLY thing tenant.ts reads — the invite itself never
//    grants access; 410 when expired.
// One web-only extra: the creators row is ensured first. On the phone /api/me creates it on first
// sign-in, but a brand-new invitee who signed up ON THIS PAGE has never hit /api/me — without the
// row the store_collaborators FK would reject the accept.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return corsJson({ error: 'unauthorized' }, { status: 401 });
  const email = (user.email ?? '').trim().toLowerCase();

  const b = (await req.json().catch(() => null)) as { token?: string; action?: 'accept' | 'decline' } | null;
  if (!b?.token || (b.action !== 'accept' && b.action !== 'decline')) {
    return corsJson({ error: 'invalid body' }, { status: 400 });
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
    .where(eq(schema.storeInvites.token, b.token))
    .limit(1);

  if (!invite || invite.status !== 'pending') return corsJson({ error: 'not found' }, { status: 404 });
  if (invite.expiresAt < new Date()) return corsJson({ error: 'invite expired — ask for a new one' }, { status: 410 });
  if (invite.email !== email) {
    return corsJson(
      { error: `This invite was sent to ${invite.email} — you're signed in as ${email || 'a different account'}.`, code: 'email_mismatch' },
      { status: 403 },
    );
  }

  if (b.action === 'decline') {
    await db
      .update(schema.storeInvites)
      .set({ status: 'declined', respondedAt: new Date() })
      .where(and(eq(schema.storeInvites.id, invite.id), eq(schema.storeInvites.status, 'pending')));
    return corsJson({ ok: true, declined: true });
  }

  await db
    .insert(schema.creators)
    .values({
      id: user.id,
      email: user.email,
      name: user.name ?? null,
      // The web-accept form requires the terms checkbox before signup, so acceptance is recorded
      // here for a row born on this page. Mirrors src/lib/legal.ts TERMS_VERSION; /api/me's
      // coalesce backfill never overwrites it when they later open the app.
      termsAcceptedAt: new Date(),
      termsVersion: '2026-06-18',
    })
    .onConflictDoNothing();
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
  return corsJson({ ok: true, accepted: true, store });
}
