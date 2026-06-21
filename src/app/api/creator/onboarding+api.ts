import { and, eq } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { getEntitlements } from '@/lib/billing';
import { ensureCreditAccount, getBalance, grant, TRIAL_CREDITS } from '@/lib/credits';
import { db, schema } from '@/lib/db';

// POST /api/creator/onboarding { path: 'trial' | 'free' | 'shop' }
// Records the welcome-flow choice and grants the right starting credits, idempotently.
//   • free / shop → just ensure the account exists; the SIGNUP_BONUS (300 ≈ $3) lands on first touch.
//   • trial       → grant TRIAL_CREDITS (one week of Pro) ONCE, but only after a Pro plan is genuinely
//     active/trialing (verified server-side via getEntitlements — so a bare CTA tap can't mint credits).
// Safe to call repeatedly: the trial grant is guarded by a unique ledger refId per creator, and it's
// fine if the Pro subscription hasn't landed yet (the client re-calls once the purchase verifies).
const trialRefId = (creatorId: string) => `onboard_trial:${creatorId}`;

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { path?: string } | null;
  const path = body?.path;
  if (path !== 'trial' && path !== 'free' && path !== 'shop') {
    return Response.json({ error: "path must be 'trial', 'free', or 'shop'" }, { status: 400 });
  }

  // Shoppers get a lightweight account (so they get order history + returns) but NO creator credits —
  // the $3 starting grant is for the "start free" path.
  if (path === 'shop') return Response.json({ ok: true, path });

  // free + trial → ensure the credit account, which grants the $3 SIGNUP_BONUS on first touch.
  await ensureCreditAccount(user.id);

  let proActive = false;
  if (path === 'trial') {
    const ent = await getEntitlements(user.id);
    proActive = ent.plan === 'pro' && ent.active; // active === active OR trialing paid plan
    if (proActive) {
      const refId = trialRefId(user.id);
      const [already] = await db
        .select({ refId: schema.creditLedger.refId })
        .from(schema.creditLedger)
        .where(and(eq(schema.creditLedger.creatorId, user.id), eq(schema.creditLedger.refId, refId)))
        .limit(1);
      if (!already) await grant(user.id, TRIAL_CREDITS, 'subscription_grant', refId);
    }
  }

  return Response.json({ ok: true, path, proActive, balance: await getBalance(user.id) });
}
