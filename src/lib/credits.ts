import { and, eq, gte, sql } from 'drizzle-orm';

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
  merge: 8, // /api/merge fuses 2 designs via 1 Nano Banana call → same as a generate
  design_edit: 8, // /api/edit revises 1 design via 1 Nano Banana call → same as a generate
  tryon: 6, // shopper-facing conversion feature — NOT currently debited (rate-limited instead)
  model_shots: 25, // 3 Nano Banana renders ~$0.12 → ~2×
  preview_shots: 16, // on-model PREVIEW at the placement step: 2 Nano Banana renders ~$0.08 → ~2×
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
// "$10 in free credits" granted up front to a new subscriber (any tier) so they can use the AI
// during the first week — a paid plan's monthly allotment only lands on a real invoice, which a
// brand-new sub hasn't hit yet. One-time per account. See the onboarding route.
export const WELCOME_CREDITS = 1000;

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

/** Debit an arbitrary amount (variable-cost ops, e.g. scene-video tiers). Throws if balance too low.
 *  ATOMIC: a single guarded `UPDATE ... WHERE balance >= amount` so two concurrent paid requests can't
 *  both pass a stale read and drive the balance negative (the old check-then-decrement race). If the
 *  guard matches no row, the balance was insufficient — nothing is charged and we throw. */
export async function debitCredits(creatorId: string, amount: number, reason: CreditReason, refId?: string): Promise<number> {
  const balance = await ensureCreditAccount(creatorId);
  // Comp / internal accounts are never charged (and so never hit the insufficient-credits gate).
  if (await isCompCreator(creatorId)) return balance;
  const [row] = await db
    .update(schema.creditAccounts)
    .set({ balance: sql`${schema.creditAccounts.balance} - ${amount}` })
    .where(and(eq(schema.creditAccounts.creatorId, creatorId), gte(schema.creditAccounts.balance, amount)))
    .returning({ balance: schema.creditAccounts.balance });
  if (!row) throw new InsufficientCreditsError(amount, balance); // guard didn't match → too low, nothing charged
  await db.insert(schema.creditLedger).values({ creatorId, delta: -amount, reason, refId: refId ?? null, balanceAfter: row.balance });
  return row.balance;
}

/** Debit a fixed-cost operation. Throws InsufficientCreditsError if the balance is too low. */
export async function debit(creatorId: string, op: keyof typeof CREDIT_COSTS, refId?: string): Promise<number> {
  return debitCredits(creatorId, CREDIT_COSTS[op], op, refId);
}
