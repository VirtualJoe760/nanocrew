import { and, eq, sql } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';

// POST /api/creator/push-token { token, platform? } — register (or refresh) an Expo push
// token for the signed-in creator. Idempotent on the token; re-registering bumps lastSeen
// and re-points the token at this creator (devices can change hands). DELETE removes it
// (e.g. on sign-out or when notifications are disabled).
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { token?: string; platform?: string } | null;
  if (!body?.token || !body.token.startsWith('ExponentPushToken')) {
    return Response.json({ error: 'valid Expo token required' }, { status: 400 });
  }
  try {
    await db
      .insert(schema.deviceTokens)
      .values({ creatorId: user.id, token: body.token, platform: body.platform ?? null })
      .onConflictDoUpdate({
        target: schema.deviceTokens.token,
        set: { creatorId: user.id, platform: body.platform ?? null, lastSeenAt: sql`now()` },
      });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const token = new URL(req.url).searchParams.get('token');
  if (!token) return Response.json({ error: 'token required' }, { status: 400 });
  try {
    // Scope the delete to THIS creator's token — otherwise knowing another creator's token value
    // would let you unregister their device (notification DoS).
    await db
      .delete(schema.deviceTokens)
      .where(and(eq(schema.deviceTokens.token, token), eq(schema.deviceTokens.creatorId, user.id)));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
