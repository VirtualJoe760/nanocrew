import { desc, eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { CREDIT_COSTS, getBalance } from '@/lib/credits';
import { VIDEO_MODEL_OPTIONS } from '@/lib/fal-video';

// GET /api/creator/credits — the creator's current balance, the per-operation price list
// (so the app can show "this costs 25 credits"), the scene-video model tiers (variable cost),
// and a short ledger for transparency.
// Touching this also ensures the account exists and grants the signup bonus on first call.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const balance = await getBalance(user.id);
    const ledger = await db
      .select({
        delta: schema.creditLedger.delta,
        reason: schema.creditLedger.reason,
        balanceAfter: schema.creditLedger.balanceAfter,
        createdAt: schema.creditLedger.createdAt,
      })
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.creatorId, user.id))
      .orderBy(desc(schema.creditLedger.createdAt))
      .limit(20);
    return Response.json({ balance, costs: CREDIT_COSTS, videoModels: VIDEO_MODEL_OPTIONS, ledger });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
