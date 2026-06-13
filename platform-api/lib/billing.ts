import { eq, sql } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// Webhook-side billing writes: activate/refresh a subscription and grant credits. The app
// owns the customer-facing tier catalogue; this file only needs the monthly credit amounts
// (kept in sync with src/lib/billing.ts TIERS).

type PaidPlan = 'starter' | 'pro' | 'advanced';

const MONTHLY_CREDITS: Record<PaidPlan, number> = {
  starter: 500,
  pro: 3000,
  advanced: 15000,
};

export function monthlyCreditsFor(plan: string): number {
  return MONTHLY_CREDITS[plan as PaidPlan] ?? 0;
}

/** Add credits and record a ledger row, creating the account if needed. Idempotent guard
 *  is the caller's job (via refId uniqueness checks) — here we just move the balance. */
export async function grantCredits(creatorId: string, amount: number, reason: string, refId?: string): Promise<void> {
  await db
    .insert(schema.creditAccounts)
    .values({ creatorId, balance: 0 })
    .onConflictDoNothing();
  const [row] = await db
    .update(schema.creditAccounts)
    .set({ balance: sql`${schema.creditAccounts.balance} + ${amount}` })
    .where(eq(schema.creditAccounts.creatorId, creatorId))
    .returning({ balance: schema.creditAccounts.balance });
  await db.insert(schema.creditLedger).values({
    creatorId,
    delta: amount,
    reason,
    refId: refId ?? null,
    balanceAfter: row?.balance ?? amount,
  });
}

/** True if a ledger row already exists for this (reason, refId) — used to make grants
 *  idempotent against Stripe's at-least-once webhook delivery. */
export async function ledgerHas(reason: string, refId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.creditLedger.id })
    .from(schema.creditLedger)
    .where(sql`${schema.creditLedger.reason} = ${reason} and ${schema.creditLedger.refId} = ${refId}`)
    .limit(1);
  return !!row;
}

interface SubInput {
  creatorId: string;
  plan: string;
  status: string;
  stripeCustomerId: string;
  stripeSubscriptionId?: string | null;
  currentPeriodEnd?: Date | null;
}

/** Upsert the creator's single subscription row. */
export async function upsertSubscription(input: SubInput): Promise<void> {
  const [existing] = await db
    .select({ id: schema.subscriptions.id })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.creatorId, input.creatorId))
    .limit(1);
  const values = {
    plan: input.plan as 'free' | 'starter' | 'pro' | 'advanced',
    status: input.status as 'active' | 'trialing' | 'past_due' | 'canceled',
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId ?? null,
    currentPeriodEnd: input.currentPeriodEnd ?? null,
  };
  if (existing) {
    await db.update(schema.subscriptions).set(values).where(eq(schema.subscriptions.id, existing.id));
  } else {
    await db.insert(schema.subscriptions).values({ creatorId: input.creatorId, ...values });
  }
}

/** Flip a subscription's status by its Stripe subscription id (cancel / past_due events). */
export async function setSubscriptionStatusByStripeId(stripeSubscriptionId: string, status: string, currentPeriodEnd?: Date | null): Promise<void> {
  await db
    .update(schema.subscriptions)
    .set({
      status: status as 'active' | 'trialing' | 'past_due' | 'canceled',
      ...(currentPeriodEnd !== undefined ? { currentPeriodEnd } : {}),
    })
    .where(eq(schema.subscriptions.stripeSubscriptionId, stripeSubscriptionId));
}
