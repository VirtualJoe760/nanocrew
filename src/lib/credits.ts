import { eq, sql } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { isCompCreator } from '@/lib/comp';

// Credit metering. 1 credit ≈ $0.01 retail. Costs already include our markup over the
// real AI spend, so debits = revenue and the ledger doubles as the cost/profit audit.

// Charges are sized at ≥2× our real API cost measured at the $0.01/credit floor (see CREDIT_PACKS).
// Nano Banana (gemini-2.5-flash-image) = ~$0.039/image; Veo 3 Fast = ~$0.15/s; ElevenLabs voiceover
// ~$0.01. So 2× cost ≈ (cost$ × 200) credits.
export const CREDIT_COSTS = {
  video_voiceover: 25, // ~$0.01 real → huge margin (content floor)
  video_veo: 400, // Veo 3 Fast 8s ~$1.20 real → ~3.3× (premium tier, kept generous)
  design_generate: 8, // 1 Nano Banana image ~$0.039 → ~2× at the $0.01/cr floor
  logo_generate: 8,
  tryon: 6, // shopper-facing conversion feature — NOT currently debited (rate-limited instead)
  model_shots: 25, // 3 Nano Banana renders ~$0.12 → ~2×
  revision: 60,
  // NOTE: scene-video ("cool short") is variable-cost — the creator picks a model tier whose price
  // lives in VIDEO_MODELS (src/lib/fal-video.ts). It charges via debitCredits() with reason
  // 'scene_video', not a fixed entry here.
} as const;

export type CreditReason =
  | keyof typeof CREDIT_COSTS
  | 'scene_video'
  | 'domain' // variable: buying a custom domain (price → credits in src/lib/domains.ts)
  | 'signup_bonus'
  | 'topup'
  | 'subscription_grant'
  | 'refund';

// Starting credits granted on first account touch — "$3 of credits for creating an account"
// (1 credit ≈ $0.01). Enough for a couple of generations before the upgrade nudge. Tune here.
export const SIGNUP_BONUS = 300;
// One week of the Pro allotment (3,000/mo ÷ 4), granted once when a Pro free-trial starts (the
// monthly 3,000 only lands on a real invoice, which a trial hasn't hit yet). See the onboarding route.
export const TRIAL_CREDITS = 750;

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

/** Debit an arbitrary amount (variable-cost ops, e.g. scene-video tiers). Throws if balance too low. */
export async function debitCredits(creatorId: string, amount: number, reason: CreditReason, refId?: string): Promise<number> {
  const balance = await ensureCreditAccount(creatorId);
  // Comp / internal accounts are never charged (and so never hit the insufficient-credits gate).
  if (await isCompCreator(creatorId)) return balance;
  if (balance < amount) throw new InsufficientCreditsError(amount, balance);
  return move(creatorId, -amount, reason, refId);
}

/** Debit a fixed-cost operation. Throws InsufficientCreditsError if the balance is too low. */
export async function debit(creatorId: string, op: keyof typeof CREDIT_COSTS, refId?: string): Promise<number> {
  return debitCredits(creatorId, CREDIT_COSTS[op], op, refId);
}
