import { and, eq, inArray } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { accessibleStoreIds } from '@/lib/tenant';

// POST /api/creator/returns/:id/decline — the brand declines a return claim. Marks the claim
// 'declined' with the resolution reason, then reverts the order out of 'return_requested' back to a
// fulfillment state. We don't snapshot the pre-claim status, so we revert to 'shipped' — the
// known-true state the package was in (returnWindowEndsAt only gets set on ship; a claim can only be
// opened after that). No money moves on a decline. Ownership scoped by accessibleStoreIds().
export async function POST(req: Request, { id }: Record<string, string>) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const storeIds = await accessibleStoreIds(user.id);
    if (!storeIds.length) return Response.json({ error: 'not found' }, { status: 404 });

    const [claim] = await db
      .select({
        id: schema.returnRequests.id,
        orderId: schema.returnRequests.orderId,
        status: schema.returnRequests.status,
      })
      .from(schema.returnRequests)
      .where(and(eq(schema.returnRequests.id, id), inArray(schema.returnRequests.storeId, storeIds)))
      .limit(1);
    if (!claim) return Response.json({ error: 'not found' }, { status: 404 });

    // Idempotent / guard: only an open 'requested' claim can be declined.
    if (claim.status === 'declined') return Response.json({ status: 'declined' });
    if (claim.status !== 'requested') {
      return Response.json({ error: `this claim is already ${claim.status}` }, { status: 409 });
    }

    const body = (await req.json().catch(() => null)) as { reason?: string; resolution?: string } | null;
    const reason = typeof body?.resolution === 'string' && body.resolution.trim()
      ? body.resolution.trim().slice(0, 2000)
      : typeof body?.reason === 'string' && body.reason.trim()
        ? body.reason.trim().slice(0, 2000)
        : 'Declined.';

    await db
      .update(schema.returnRequests)
      .set({ status: 'declined', resolution: reason, resolvedAt: new Date() })
      .where(eq(schema.returnRequests.id, claim.id));

    // Revert the order out of the claim hold. Only flip if it's still 'return_requested' (don't stomp
    // a status another webhook may have moved it to in the meantime).
    await db
      .update(schema.orders)
      .set({ status: 'shipped' })
      .where(and(eq(schema.orders.id, claim.orderId), eq(schema.orders.status, 'return_requested')));

    // Best-effort decline email via the central notify service (Resend stays in platform-api).
    await notifyDeclined(claim.id, reason).catch(() => {});

    return Response.json({ status: 'declined' });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}

// Fire-and-forget call to the platform-api internal notify route (INTERNAL_API_KEY-gated). No-ops
// when the key or base URL is unset (dev). Resend lives only in platform-api.
async function notifyDeclined(returnId: string, reason: string): Promise<void> {
  const base = (process.env.PLATFORM_API_BASE ?? '').trim().replace(/\/+$/, '');
  const key = process.env.INTERNAL_API_KEY;
  if (!base || !key) return;
  await fetch(`${base}/api/internal/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': key },
    body: JSON.stringify({ action: 'declined', returnId, reason }),
  });
}
