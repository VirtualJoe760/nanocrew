import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';

// GET /api/me — verify the Supabase access token, ensure a creators row exists, and
// return the profile (+ their stores). The app calls this right after sign-in.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    await db
      .insert(schema.creators)
      .values({ id: user.id, email: user.email })
      .onConflictDoNothing({ target: schema.creators.id });
    const stores = await db
      .select({ id: schema.stores.id, name: schema.stores.name, slug: schema.stores.slug, status: schema.stores.status })
      .from(schema.stores)
      .where(eq(schema.stores.creatorId, user.id));
    return Response.json({ creator: { id: user.id, email: user.email }, stores });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
