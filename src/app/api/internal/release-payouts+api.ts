import { timingSafeEqual } from 'node:crypto';

import { and, eq, isNull, lt, notInArray } from 'drizzle-orm';

import { releasePayout } from '@/lib/connect';
import { db, schema } from '@/lib/db';
import { notifyPlatform } from '@/lib/notify-internal';

// POST /api/internal/release-payouts — the deferred-payout release job (held-marketplace model).
//
// Under separate charges + transfers a sale captures 100% to the platform and the brand's net is
// HELD until the return window closes (ship date + RETURN_WINDOW_DAYS). This job scans for orders
// whose hold has elapsed with no open return/refund and transfers each brand its net. It runs on
// the persistent Cloud Run backend (NOT EAS Hosting — see CLAUDE.md) so the long Stripe loop can't
// be killed mid-flight by a serverless timeout. See docs/accounts/RETURNS_REFUNDS.md (the release job).
//
// SCHEDULING — LIVE since 2026-08-16: Cloud Scheduler job `release-payouts` (project nanocrew-api,
// us-west1) POSTs this route at 0 17 1,15 * * UTC — the 1st and 15th, Joe's biweekly disbursement —
// with the internal key. Alerting should watch the non-zero `failed` count and `stuckHeld` in the
// response (Cloud Scheduler logs the response of each run).
//
// Auth: INTERNAL_API_KEY via the x-internal-key header, constant-time compared (mirrors the
// first-drop service path). Idempotent + durable: each order is re-guarded on payoutStatus='held'
// at transfer time and releasePayout() uses a per-order Stripe idempotency key, so a retried or
// overlapping run can never double-pay.

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? '';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// Money is HELD only until the window clears; these terminal/in-flight states must NOT release —
// a refund/return (or a failed/cancelled order) means the brand should not be paid for it.
const BLOCKED_STATUSES = ['return_requested', 'returned', 'refunded', 'cancelled', 'failed'] as const;

export async function POST(req: Request) {
  const key = req.headers.get('x-internal-key') ?? '';
  if (!INTERNAL_API_KEY || !safeEqual(key, INTERNAL_API_KEY)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  // First op is a DB read (satisfies the Railway/postgres-js "no fetch before the first DB query"
  // rule — releasePayout's Stripe calls only happen after this scan).
  const due = await db
    .select({
      id: schema.orders.id,
      brandNetCents: schema.orders.brandNetCents,
      connectedAccountId: schema.orders.connectedAccountId,
      stripeChargeId: schema.orders.stripeChargeId,
      currency: schema.orders.currency,
      payoutStatus: schema.orders.payoutStatus,
    })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.payoutStatus, 'held'),
        lt(schema.orders.payoutReleaseAt, new Date()),
        notInArray(schema.orders.status, [...BLOCKED_STATUSES]),
      ),
    )
    .limit(500);

  let released = 0;
  let failed = 0;
  const errors: { orderId: string; error: string }[] = [];
  for (const order of due) {
    try {
      // releasePayout re-derives the terminal state and is idempotent (per-order Stripe key); a
      // concurrent run that already released this order is a safe no-op here.
      await releasePayout(order);
      released += 1;
      // Tell the creator their money is on the way (best-effort; never fails the release).
      await notifyPlatform({ action: 'payout', orderId: order.id });
    } catch (e) {
      failed += 1;
      const message = e instanceof Error ? e.message : 'release failed';
      errors.push({ orderId: order.id, error: message });
      // Keep going — one brand's transfer failure must not stall the rest. The non-zero `failed`
      // count + these errors are what the owner's alerting should page on.
      console.error('[release-payouts]', order.id, message);
    }
  }

  // STUCK-FUNDS SWEEP. An order only ever gets a payoutReleaseAt from Printful's package_shipped
  // webhook — if that webhook never arrives (Printful hiccup, misrouted store id), the money sits
  // 'held' with a NULL release date and the scan above can never match it (lt() is never true for
  // NULL). That's a creator silently never getting paid. Surface them here so the scheduler run's
  // log/alerting sees a non-empty stuckHeld instead of nobody ever noticing.
  const staleCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const stuck = await db
    .select({ id: schema.orders.id, status: schema.orders.status, createdAt: schema.orders.createdAt })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.payoutStatus, 'held'),
        isNull(schema.orders.payoutReleaseAt),
        lt(schema.orders.createdAt, staleCutoff),
        notInArray(schema.orders.status, [...BLOCKED_STATUSES]),
      ),
    )
    .limit(100);
  if (stuck.length) {
    console.error('[release-payouts] STUCK HELD FUNDS — held >14d with no ship webhook:', stuck.map((s) => s.id).join(', '));
  }

  return Response.json({ scanned: due.length, released, failed, errors, stuckHeld: stuck.length, stuckHeldIds: stuck.map((s) => s.id) });
}
