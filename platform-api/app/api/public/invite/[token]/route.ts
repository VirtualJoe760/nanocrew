import { eq } from 'drizzle-orm';

import { corsJson, corsPreflight } from '@/lib/cors';
import { db, schema } from '@/lib/db';

export const OPTIONS = corsPreflight;
export const dynamic = 'force-dynamic'; // status flips server-side — never serve a cached verdict

// GET /api/public/invite/:token — resolve an invite token to a presentable summary.
//
// This exists so the invite PAGE can live on nanocrew.app (the site) instead of on this API host.
// The site holds no database credential by design (see nanocrew-site/lib/store.ts), so it asks for
// this the same way it asks for the public catalogue: plain HTTP, CORS, no secret.
//
// Unauthenticated on purpose — the token IS the credential, and it only yields display copy. The
// invited address is MASKED here: the page needs to hint which account to use, but a token in a
// forwarded email shouldn't hand over a clean address. The real check is server-side at accept.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const [invite] = await db
    .select({
      email: schema.storeInvites.email,
      status: schema.storeInvites.status,
      expiresAt: schema.storeInvites.expiresAt,
      storeId: schema.storeInvites.storeId,
      invitedBy: schema.storeInvites.invitedBy,
    })
    .from(schema.storeInvites)
    .where(eq(schema.storeInvites.token, token))
    .limit(1);

  // Deliberately generic — a guessed token learns nothing about which invites exist.
  if (!invite) return corsJson({ state: 'not_found' }, { status: 404 });
  if (invite.status === 'accepted') return corsJson({ state: 'accepted' });
  if (invite.status !== 'pending' || invite.expiresAt < new Date()) return corsJson({ state: 'inactive' });

  const [store] = await db
    .select({ name: schema.stores.name, slug: schema.stores.slug })
    .from(schema.stores)
    .where(eq(schema.stores.id, invite.storeId))
    .limit(1);
  const [inviter] = await db
    .select({ name: schema.creators.name })
    .from(schema.creators)
    .where(eq(schema.creators.id, invite.invitedBy))
    .limit(1);

  return corsJson({
    state: 'pending',
    storeName: store?.name ?? 'a Nano Crew brand',
    storeSlug: store?.slug ?? null,
    inviterName: inviter?.name ?? 'The owner',
    emailHint: maskEmail(invite.email),
  });
}

/** j•••••@gmail.com — enough to recognise your own address, not enough to harvest it. */
function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return '•••';
  // Fixed-width mask: never leak the address length either, and a long plus-address doesn't
  // stretch the card (a 22-dot run looked broken on the page).
  return `${user.slice(0, 1)}${'•'.repeat(5)}@${domain}`;
}
