import { eq, inArray } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { accessibleStoreIds } from '@/lib/tenant';

// GET /api/me — verify the Supabase access token, ensure a creators row exists, and
// return the profile (+ their stores). The app calls this right after sign-in.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    await db
      .insert(schema.creators)
      .values({ id: user.id, email: user.email })
      .onConflictDoNothing();
    const stores = await db
      .select({ id: schema.stores.id, name: schema.stores.name, slug: schema.stores.slug, status: schema.stores.status })
      .from(schema.stores)
      .where(inArray(schema.stores.id, await accessibleStoreIds(user.id)));
    return Response.json({ creator: { id: user.id, email: user.email }, stores });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}

// DELETE /api/me — permanently delete the creator's account and all their data. Required by
// the App Store (and the Meta data-deletion policy) for any app with account creation.
// Deleting the creators row cascades to stores → catalogues/designs/products/orders/
// subscriptions/credits/device tokens. Likes (keyed by the raw auth id) are removed too,
// and we best-effort delete the Supabase auth identity when a service role key is present.
export async function DELETE(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    await db.delete(schema.productLikes).where(eq(schema.productLikes.userId, user.id)).catch(() => {});
    await db.delete(schema.creators).where(eq(schema.creators.id, user.id));

    const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && serviceKey) {
      await fetch(`${url}/auth/v1/admin/users/${user.id}`, {
        method: 'DELETE',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      }).catch(() => {});
    }
    // NOTE: live Printful sync products + active Stripe subscriptions are not auto-removed here
    // (they need their own API calls) — clean those up out of band if a creator had a live store.
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
