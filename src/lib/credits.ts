import { eq, sql } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// Credit metering. 1 credit ≈ $0.01 retail. Costs already include our markup over the
// real AI spend, so debits = revenue and the ledger doubles as the cost/profit audit.

export const CREDIT_COSTS = {
  video_voiceover: 25, // ~$0.10 real → 25 credits (~2.5×)
  video_veo: 400, // ~$1-3 real → 400 credits
  design_generate: 5,
  logo_generate: 8,
  tryon: 6,
  model_shots: 20, // ~3 on-model renders
  scene_video: 80, // Nano Banana on-model scene image → Seedance image-to-video (tune to Seedance's per-second price)
  revision: 60,
} as const;

export type CreditReason = keyof typeof CREDIT_COSTS | 'signup_bonus' | 'topup' | 'subscription_grant' | 'refund';

const SIGNUP_BONUS = 200; // enough to try things (~8 voiceover ads)

/** Ensure the creator has a credit account, granting the signup bonus on first touch. */
export async function ensureCreditAccount(creatorId: string): Promise<number> {
  const [existing] = await db
    .select({ balance: schema.creditAccounts.balance })
    .from(schema.creditAccounts)
    .where(eq(schema.creditAccounts.creatorId, creatorId))
    .limit(1);
  if (existing) return existing.balance;
  await db.insert(schema.creditAccounts).values({ creatorId, balance: SIGNUP_BONUS }).onConflictDoNothing();
  await db.insert(schema.creditLedger).values({
    creatorId,
    delta: SIGNUP_BONUS,
    reason: 'signup_bonus',
    balanceAfter: SIGNUP_BONUS,
  });
  return SIGNUP_BONUS;
}

export async function getBalance(creatorId: string): Promise<number> {
  return ensureCreditAccount(creatorId);
}

/** Atomically add (positive) or remove (negative) credits, recording the ledger row. */
async function move(creatorId: string, delta: number, reason: CreditReason, refId?: string): Promise<number> {
  const [row] = await db
    .update(schema.creditAccounts)
    .set({ balance: sql`${schema.creditAccounts.balance} + ${delta}` })
    .where(eq(schema.creditAccounts.creatorId, creatorId))
    .returning({ balance: schema.creditAccounts.balance });
  const balanceAfter = row?.balance ?? 0;
  await db.insert(schema.creditLedger).values({ creatorId, delta, reason, refId: refId ?? null, balanceAfter });
  return balanceAfter;
}

export async function grant(creatorId: string, amount: number, reason: CreditReason, refId?: string): Promise<number> {
  await ensureCreditAccount(creatorId);
  return move(creatorId, Math.abs(amount), reason, refId);
}

export class InsufficientCreditsError extends Error {
  constructor(public needed: number, public balance: number) {
    super(`Insufficient credits: need ${needed}, have ${balance}`);
  }
}

/** Debit a fixed-cost operation. Throws InsufficientCreditsError if the balance is too low. */
export async function debit(creatorId: string, op: keyof typeof CREDIT_COSTS, refId?: string): Promise<number> {
  const cost = CREDIT_COSTS[op];
  const balance = await ensureCreditAccount(creatorId);
  if (balance < cost) throw new InsufficientCreditsError(cost, balance);
  return move(creatorId, -cost, op, refId);
}
