import { and, eq, inArray } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { refundOrder } from '@/lib/connect';
import { db, schema } from '@/lib/db';
import { accessibleStoreIds } from '@/lib/tenant';

// POST /api/creator/returns/:id/approve — the brand approves a return claim and the buyer is
// refunded. This does NOT move money itself: it calls refundOrder() (src/lib/connect.ts), the
// single refund path, which issues the Stripe refund and branches on payoutStatus (held → skip the
// un-sent transfer; released → reverse it) and flips the order to 'refunded'. We then mark the claim
// 'refunded' with the refund id. Ownership is scoped by accessibleStoreIds() (owner + collaborators).
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
        refundId: schema.returnRequests.refundId,
      })
      .from(schema.returnRequests)
      .where(and(eq(schema.returnRequests.id, id), inArray(schema.returnRequests.storeId, storeIds)))
      .limit(1);
    if (!claim) return Response.json({ error: 'not found' }, { status: 404 });

    // Idempotent: already resolved → return the existing outcome rather than double-refunding.
    if (claim.status === 'refunded') return Response.json({ status: 'refunded', refundId: claim.refundId });
    if (claim.status === 'declined') return Response.json({ error: 'this claim was already declined' }, { status: 409 });

    // Optional brand note on the resolution; falls back to a standard line.
    const body = (await req.json().catch(() => null)) as { resolution?: string } | null;
    const resolution = typeof body?.resolution === 'string' && body.resolution.trim()
      ? body.resolution.trim().slice(0, 2000)
      : 'Approved — refund issued.';

    // Issue the refund via the shared path. refundOrder is idempotent + sets the order 'refunded'.
    let refundId: string;
    try {
      ({ refundId } = await refundOrder(claim.orderId));
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : 'refund failed' }, { status: 502 });
    }

    const [updated] = await db
      .update(schema.returnRequests)
      .set({
        status: 'refunded',
        refundId,
        resolution,
        resolvedAt: new Date(),
      })
      .where(eq(schema.returnRequests.id, claim.id))
      .returning();

    // Best-effort approved/refund email via the central notify service (Resend stays in platform-api).
    // Done AFTER all DB writes — never block or fail the approval on an email outage. The
    // charge.refunded webhook also fires the refund-confirmation email, so this is belt-and-suspenders.
    await notifyResolved('approved', updated.id).catch(() => {});

    return Response.json({ status: 'refunded', refundId });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}

// Fire-and-forget call to the platform-api internal notify route (INTERNAL_API_KEY-gated). When the
// key or base URL is unset (dev), this no-ops. Resend lives only in platform-api.
async function notifyResolved(action: 'approved' | 'declined', returnId: string): Promise<void> {
  const base = (process.env.PLATFORM_API_BASE ?? '').trim().replace(/\/+$/, '');
  const key = process.env.INTERNAL_API_KEY;
  if (!base || !key) return;
  await fetch(`${base}/api/internal/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': key },
    body: JSON.stringify({ action, returnId }),
  });
}
