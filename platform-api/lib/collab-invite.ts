import { and, eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { sendCollabInvite } from '@/lib/notify';

// Sending a collaboration invite email, in ONE place. Two callers reach it: the internal notify
// route (which the app's Cloud Run backend posts to after it writes the invite) and the web's own
// /api/creator/stores/[slug]/collaborators route. Without this they'd be a third and fourth copy of
// the same link-building and the email would drift between surfaces.
//
// Best-effort and silent on a missing/non-pending row: the invite may have been revoked or accepted
// between the write and this call, and that race must never surface as a failure of the creator's
// action.
export async function sendInviteEmail(inviteId: string): Promise<void> {
  const [invite] = await db
    .select({
      email: schema.storeInvites.email,
      token: schema.storeInvites.token,
      storeId: schema.storeInvites.storeId,
      invitedBy: schema.storeInvites.invitedBy,
    })
    .from(schema.storeInvites)
    .where(and(eq(schema.storeInvites.id, inviteId), eq(schema.storeInvites.status, 'pending')))
    .limit(1);
  if (!invite) return;

  const [store] = await db
    .select({ name: schema.stores.name })
    .from(schema.stores)
    .where(eq(schema.stores.id, invite.storeId))
    .limit(1);
  if (!store) return;

  const [inviter] = await db
    .select({ name: schema.creators.name })
    .from(schema.creators)
    .where(eq(schema.creators.id, invite.invitedBy))
    .limit(1);

  // Email links go through our OWN domain, never a raw vercel.app host: nanocrew.app serves the
  // invite page, platform-api serves its data + the accept endpoint.
  const base = (process.env.EMAIL_LINK_BASE ?? 'https://nanocrew.app').trim().replace(/\/+$/, '');
  await sendCollabInvite({
    to: invite.email,
    brandName: store.name,
    inviterName: inviter?.name ?? null,
    acceptUrl: `${base}/invite/${invite.token}`,
  });
}
