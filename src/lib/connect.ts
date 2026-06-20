import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// Stripe Connect — each creator gets one Express connected account; their brands' storefront
// checkouts route money to it (a destination charge with an application fee = the platform's cut).
// Like billing.ts we talk to Stripe over plain REST so the Expo app needs no Stripe SDK; the
// signature-verifying webhook that syncs charges_enabled lives in platform-api.
//
// INERT until set up: account creation only works once Connect is enabled on the platform Stripe
// account (otherwise Stripe rejects /v1/accounts and we surface a friendly message). The go-live
// gate is only enforced when STRIPE_CONNECT_ENABLED is set, so the existing flow is unaffected
// until Joe turns Connect on.

const STRIPE_BASE = 'https://api.stripe.com/v1';

/** Master switch for the go-live gate. When unset, going live does NOT require Connect (current
 *  behavior); when set, a store can only go live once its creator's account is charges_enabled. */
export function connectEnabled(): boolean {
  return !!process.env.STRIPE_CONNECT_ENABLED && !!process.env.STRIPE_SECRET_KEY;
}

function stripeKey(): string {
  const k = process.env.STRIPE_SECRET_KEY;
  if (!k) throw new Error('STRIPE_SECRET_KEY missing');
  return k;
}

function encode(params: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') parts.push(encode(v as Record<string, unknown>, key));
    else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return parts.filter(Boolean).join('&');
}

async function stripePost(
  path: string,
  params: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${STRIPE_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // A stable per-operation key makes a retried POST safe — Stripe replays the original result.
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: encode(params),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error((json.error as { message?: string } | undefined)?.message ?? 'stripe error');
  return json;
}

async function stripeGet(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${STRIPE_BASE}${path}`, { headers: { Authorization: `Bearer ${stripeKey()}` } });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error((json.error as { message?: string } | undefined)?.message ?? 'stripe error');
  return json;
}

export interface ConnectStatus {
  stripeAccountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}

const NO_ACCOUNT: ConnectStatus = { stripeAccountId: null, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false };

/** The creator's connected account row, or null. */
export async function getConnectedAccount(creatorId: string): Promise<ConnectStatus> {
  const [row] = await db
    .select({
      stripeAccountId: schema.connectedAccounts.stripeAccountId,
      chargesEnabled: schema.connectedAccounts.chargesEnabled,
      payoutsEnabled: schema.connectedAccounts.payoutsEnabled,
      detailsSubmitted: schema.connectedAccounts.detailsSubmitted,
    })
    .from(schema.connectedAccounts)
    .where(eq(schema.connectedAccounts.creatorId, creatorId))
    .limit(1);
  return row ?? NO_ACCOUNT;
}

/** Ensure the creator has a Stripe Express account (creates one on first call). Throws if Connect
 *  isn't enabled on the platform yet — callers decide whether that's fatal or best-effort. */
export async function ensureConnectedAccount(creatorId: string, email: string): Promise<string> {
  const existing = await getConnectedAccount(creatorId);
  if (existing.stripeAccountId) return existing.stripeAccountId;

  const account = await stripePost('/accounts', {
    type: 'express',
    email,
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    business_profile: { product_description: 'Creator clothing brand on Nano Crew' },
    metadata: { creatorId },
  });
  const stripeAccountId = account.id as string;
  await db
    .insert(schema.connectedAccounts)
    .values({ creatorId, stripeAccountId })
    .onConflictDoNothing();
  return stripeAccountId;
}

/** A Stripe-hosted onboarding link for the creator to finish identity/bank verification. */
export async function createOnboardingLink(stripeAccountId: string): Promise<string> {
  const base = process.env.BILLING_RETURN_URL ?? process.env.PLATFORM_API_BASE ?? 'https://nanocrew.app';
  const link = await stripePost('/account_links', {
    account: stripeAccountId,
    refresh_url: `${base}/connect/refresh`,
    return_url: `${base}/connect/return`,
    type: 'account_onboarding',
  });
  return link.url as string;
}

/** Pull the live capability flags from Stripe and persist them (also called by the webhook path). */
export async function refreshConnectedAccount(creatorId: string): Promise<ConnectStatus> {
  const current = await getConnectedAccount(creatorId);
  if (!current.stripeAccountId) return current;
  const acct = await stripeGet(`/accounts/${current.stripeAccountId}`);
  const status: ConnectStatus = {
    stripeAccountId: current.stripeAccountId,
    chargesEnabled: !!acct.charges_enabled,
    payoutsEnabled: !!acct.payouts_enabled,
    detailsSubmitted: !!acct.details_submitted,
  };
  await db
    .update(schema.connectedAccounts)
    .set({ chargesEnabled: status.chargesEnabled, payoutsEnabled: status.payoutsEnabled, detailsSubmitted: status.detailsSubmitted })
    .where(eq(schema.connectedAccounts.creatorId, creatorId));
  return status;
}

/** Refund a payment over REST. For a Connect destination charge, reverse the brand's transfer and
 *  claw back the platform's application fee proportionally, so both parties give back their share. */
export async function refundPayment(paymentIntentId: string, opts: { reverseTransfer: boolean }): Promise<void> {
  await stripePost('/refunds', {
    payment_intent: paymentIntentId,
    ...(opts.reverseTransfer ? { reverse_transfer: true, refund_application_fee: true } : {}),
  });
}

// ---------- Deferred payout (separate charges + transfers — the held-marketplace model) ----------
// Under separate charges + transfers a sale captures 100% to the platform; the brand's net is HELD
// (payoutStatus='held') until ship date + RETURN_WINDOW_DAYS, then transferred. A refund inside the
// window simply cancels the un-sent transfer (no claw-back). See docs/accounts/RETURNS_REFUNDS.md.

/** The order fields releasePayout needs. The release job selects exactly these. */
export interface ReleasablePayout {
  id: string;
  brandNetCents: number;
  connectedAccountId: string | null;
  stripeChargeId: string | null;
  currency?: string | null;
  payoutStatus?: string | null;
}

/** Transfer a held order's net to the brand's connected account, then mark it released. Idempotent:
 *  guarded by the caller on payoutStatus='held', and a per-order Stripe idempotency key so a retried
 *  release can't double-pay. Sets payoutTransferId + payoutStatus='released'. */
export async function releasePayout(order: ReleasablePayout): Promise<void> {
  if (!order.connectedAccountId || order.brandNetCents <= 0 || !order.stripeChargeId) {
    // Nothing transferable (no destination, zero net, or no source charge) — there's no payout to
    // make. Settle the state so the release job stops re-scanning it.
    await db
      .update(schema.orders)
      .set({ payoutStatus: 'released' })
      .where(eq(schema.orders.id, order.id));
    return;
  }
  const transfer = await stripePost(
    '/transfers',
    {
      amount: order.brandNetCents,
      currency: (order.currency ?? 'usd').toLowerCase(),
      destination: order.connectedAccountId,
      // Bind the transfer to the original charge so Stripe draws from those exact funds.
      source_transaction: order.stripeChargeId,
      transfer_group: order.id,
    },
    // Idempotency: a retried release for the same order returns the original transfer, never a second one.
    `release_${order.id}`,
  );
  await db
    .update(schema.orders)
    .set({ payoutTransferId: transfer.id as string, payoutStatus: 'released' })
    .where(eq(schema.orders.id, order.id));
}

/** Refund an order, branching on its payout state (the held-marketplace refund):
 *   - 'held'     → refund the buyer; the brand was never paid, so cancel the un-sent transfer
 *                  (payoutStatus='skipped'). No reverse_transfer — the common, claw-back-free case.
 *   - 'released' → refund the buyer AND reverse the already-sent transfer (payoutStatus='reversed').
 *   - 'none'     → plain platform refund (no Connect transfer existed).
 *  Sets order status 'refunded'. Idempotent: a re-call on an already-refunded order is a no-op. */
export async function refundOrder(orderId: string): Promise<{ refundId: string }> {
  const [order] = await db
    .select({
      id: schema.orders.id,
      status: schema.orders.status,
      paymentIntentId: schema.orders.stripePaymentIntentId,
      payoutStatus: schema.orders.payoutStatus,
      payoutTransferId: schema.orders.payoutTransferId,
    })
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .limit(1);
  if (!order) throw new Error('order not found');
  if (!order.paymentIntentId) throw new Error('no payment to refund');
  // Idempotent: already refunded → don't issue a second Stripe refund.
  if (order.status === 'refunded') return { refundId: '' };

  // Refund the buyer. Under SEPARATE charges + transfers the charge has no linked transfer, so we do
  // NOT pass reverse_transfer (that only reverses a destination charge's OWN transfer). A transfer we
  // already SENT (payoutStatus='released') is a separate object, reversed explicitly below.
  const refund = await stripePost(
    '/refunds',
    { payment_intent: order.paymentIntentId },
    // Idempotency: a retried refund for the same order returns the original refund, never a second one.
    `refund_${order.id}`,
  );

  // Claw back an already-released transfer by reversing the Transfer object itself (full amount). A
  // held order's transfer was never sent (just mark it skipped); a platform-settled ('none') order
  // never had one. The buyer is already refunded above, so a failed reversal can be retried safely
  // (idempotency key) without double-refunding.
  if (order.payoutStatus === 'released' && order.payoutTransferId) {
    await stripePost(`/transfers/${order.payoutTransferId}/reversals`, {}, `reverse_${order.id}`);
  }

  // Map the payout state to its terminal: released→reversed, held→skipped, none stays none.
  const nextPayoutStatus =
    order.payoutStatus === 'released' ? 'reversed' : order.payoutStatus === 'held' ? 'skipped' : order.payoutStatus;
  await db
    .update(schema.orders)
    .set({ status: 'refunded', payoutStatus: nextPayoutStatus })
    .where(eq(schema.orders.id, order.id));
  return { refundId: refund.id as string };
}

/** Go-live gate. Returns a reason string when the creator may NOT go live, or null when they can.
 *  Only enforced when Connect is enabled — otherwise the storefront settles to the platform as before. */
export async function goLiveBlockReason(creatorId: string): Promise<string | null> {
  if (!connectEnabled()) return null;
  const status = await getConnectedAccount(creatorId);
  if (!status.stripeAccountId) return 'finish setting up payments before going live';
  if (!status.chargesEnabled) return 'your payment setup is still pending — finish it before going live';
  return null;
}
