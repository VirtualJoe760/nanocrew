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

async function stripePost(path: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${STRIPE_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${stripeKey()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
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

/** Go-live gate. Returns a reason string when the creator may NOT go live, or null when they can.
 *  Only enforced when Connect is enabled — otherwise the storefront settles to the platform as before. */
export async function goLiveBlockReason(creatorId: string): Promise<string | null> {
  if (!connectEnabled()) return null;
  const status = await getConnectedAccount(creatorId);
  if (!status.stripeAccountId) return 'finish setting up payments before going live';
  if (!status.chargesEnabled) return 'your payment setup is still pending — finish it before going live';
  return null;
}
