import { desc, eq } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { corsJson, corsPreflight } from '@/lib/cors';
import { db, schema } from '@/lib/db';

export const OPTIONS = corsPreflight;
export const dynamic = 'force-dynamic';

// GET   /api/creator/account — the signed-in creator's own profile.
// PATCH /api/creator/account { name?, phone? } — edit it.
//
// The app shows this identity read-only (src/app/account.tsx profile header: avatar, email, plan
// badge, creator id) and collects name + phone at sign-up with no way to change them afterwards.
// The web is where they become editable (Joe, 2026-08-16) — the site's one signed-in function.
//
// It lives on platform-api because that is already where the web's authed /api/creator/* routes
// live (stats, orders, posts, revise) with the same bearer auth and CORS. The app's own Cloud Run
// backend can't serve it: its CORS allows only GET/POST, so a PATCH would fail preflight.
//
// EMAIL IS NOT EDITABLE here, deliberately. It's the identity key across the product — collaboration
// invites match on it (store_invites.email) and customers look up orders by it — so changing it
// casually would silently strip someone of a pending invite or their order history.

/** Only these columns are ever returned or written. */
const PROFILE = {
  id: schema.creators.id,
  email: schema.creators.email,
  name: schema.creators.name,
  phone: schema.creators.phone,
  image: schema.creators.image,
  createdAt: schema.creators.createdAt,
};

// The app's rule, mirrored exactly (src/lib/billing.ts): a TRIALING subscription is a paid plan,
// and comp accounts read as 'advanced'. Counting only 'active' showed a trialing subscriber (or
// the founder) their real plan in the app and 'FREE' on the web — the exact parity break
// ACCOUNT_SURFACE.md forbids (BUG_AUDIT_2026-08-20 #42).
const ACTIVE_STATUSES = ['active', 'trialing'];
const COMP_EMAILS = (process.env.COMP_EMAILS ?? process.env.PLATFORM_ADMIN_EMAILS ?? '')
  .toLowerCase()
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

async function planFor(creatorId: string, email: string | null | undefined): Promise<string> {
  if (email && COMP_EMAILS.includes(email.toLowerCase())) return 'advanced';
  const [sub] = await db
    .select({ plan: schema.subscriptions.plan, status: schema.subscriptions.status })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.creatorId, creatorId))
    .orderBy(desc(schema.subscriptions.createdAt))
    .limit(1);
  return sub && ACTIVE_STATUSES.includes(sub.status) ? sub.plan : 'free';
}

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return corsJson({ error: 'unauthorized' }, { status: 401 });

  // A creator who has only ever signed up on the web has no creators row until now — the app makes
  // it on first /api/me. Create it here so the account page works before they open the app.
  await db
    .insert(schema.creators)
    .values({ id: user.id, email: user.email, name: user.name ?? null })
    .onConflictDoNothing();

  const [me] = await db.select(PROFILE).from(schema.creators).where(eq(schema.creators.id, user.id)).limit(1);
  if (!me) return corsJson({ error: 'not found' }, { status: 404 });
  return corsJson({ profile: me, plan: await planFor(user.id, me.email) });
}

export async function PATCH(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return corsJson({ error: 'unauthorized' }, { status: 401 });

  const b = (await req.json().catch(() => null)) as { name?: unknown; phone?: unknown } | null;
  if (!b) return corsJson({ error: 'invalid body' }, { status: 400 });

  const patch: { name?: string | null; phone?: string | null } = {};

  if ('name' in b) {
    if (typeof b.name !== 'string') return corsJson({ error: 'name must be text' }, { status: 400 });
    const name = b.name.trim();
    if (name.length > 80) return corsJson({ error: 'Name is too long (80 characters max).' }, { status: 400 });
    patch.name = name || null; // clearing it is allowed — it's optional in the app too
  }

  if ('phone' in b) {
    if (typeof b.phone !== 'string') return corsJson({ error: 'phone must be text' }, { status: 400 });
    const phone = b.phone.trim();
    // Deliberately permissive: creators are international and this is a contact hint, not a
    // verified channel. Reject only what's obviously not a number.
    if (phone && !/^[+()\d][\d\s().-]{4,24}$/.test(phone)) {
      return corsJson({ error: "That doesn't look like a phone number." }, { status: 400 });
    }
    patch.phone = phone || null;
  }

  if (!Object.keys(patch).length) return corsJson({ error: 'nothing to update' }, { status: 400 });

  const [updated] = await db
    .update(schema.creators)
    .set(patch)
    .where(eq(schema.creators.id, user.id))
    .returning(PROFILE);
  if (!updated) return corsJson({ error: 'not found' }, { status: 404 });

  return corsJson({ profile: updated, plan: await planFor(user.id, updated.email) });
}
