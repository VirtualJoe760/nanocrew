import { and, eq } from 'drizzle-orm';

import { getUserFromRequest } from '@/lib/auth';
import { getEntitlements } from '@/lib/billing';
import { ensureCreditAccount, getBalance, grant, WELCOME_CREDITS } from '@/lib/credits';
import { db, schema } from '@/lib/db';

// POST /api/creator/onboarding { path: 'subscribe' | 'free' | 'shop' }
// Records the welcome-flow choice and grants the right starting credits, idempotently.
//   • free  → ensure the account; the SIGNUP_BONUS (300 ≈ $3) lands on first touch.
//   • shop  → lightweight account, NO creator credits.
//   • subscribe → grant WELCOME_CREDITS ($10 of credits) ONCE, but only after a paid plan (any tier)
//     is genuinely active/trialing (verified server-side via getEntitlements, so a bare CTA tap can't
//     mint credits). Safe to call repeatedly — guarded by a unique ledger refId per creator, and fine
//     if the subscription hasn't landed yet (the client re-calls once the purchase verifies).
const welcomeRefId = (creatorId: string) => `onboard_welcome:${creatorId}`;

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { path?: string } | null;
  const path = body?.path;
  if (path !== 'subscribe' && path !== 'free' && path !== 'shop') {
    return Response.json({ error: "path must be 'subscribe', 'free', or 'shop'" }, { status: 400 });
  }

  // Shoppers get a lightweight account (so they get order history + returns) but NO creator credits —
  // the $3 starting grant is for the "start free" path.
  if (path === 'shop') return Response.json({ ok: true, path });

  // free + subscribe → ensure the credit account, which grants the $3 SIGNUP_BONUS on first touch.
  await ensureCreditAccount(user.id);

  let planActive = false;
  if (path === 'subscribe') {
    const ent = await getEntitlements(user.id);
    planActive = ent.active && ent.plan !== 'free'; // active === active OR trialing paid plan
    if (planActive) {
      const refId = welcomeRefId(user.id);
      const [already] = await db
        .select({ refId: schema.creditLedger.refId })
        .from(schema.creditLedger)
        .where(and(eq(schema.creditLedger.creatorId, user.id), eq(schema.creditLedger.refId, refId)))
        .limit(1);
      if (!already) await grant(user.id, WELCOME_CREDITS, 'subscription_grant', refId);
    }
  }

  return Response.json({ ok: true, path, planActive, balance: await getBalance(user.id) });
}
