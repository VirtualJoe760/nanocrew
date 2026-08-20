import { and, eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

// Stripe Connect — each creator gets one Express connected account. Their brands' storefront
// checkouts capture 100% to the PLATFORM and the brand's net is TRANSFERRED later, once the return
// window closes (separate charges + transfers — the held-marketplace pattern; see
// docs/accounts/RETURNS_REFUNDS.md). It is NOT a destination charge with an application fee: that
// was the earlier design, and the comment outlived it.
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
/**
 * Does this account still exist under the CURRENT platform key?
 *
 * A stored id can go dead — created in test mode, or under a platform account that was since
 * rotated. Stripe then answers "does not have access ... or that account does not exist" for every
 * call, including account_links, so "Set up payouts" dead-ends forever with no way back.
 * Distinguish that from a transient outage: only a definite 4xx-style missing/permission answer
 * counts as gone, anything else is rethrown so we never discard a live account on a blip.
 */
async function accountStillExists(accountId: string): Promise<boolean> {
  try {
    await stripeGet(`/accounts/${accountId}`);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message.toLowerCase() : '';
    if (msg.includes('does not have access') || msg.includes('no such account') || msg.includes('does not exist')) {
      return false;
    }
    throw e;
  }
}

export async function ensureConnectedAccount(creatorId: string, email: string): Promise<string> {
  const existing = await getConnectedAccount(creatorId);
  if (existing.stripeAccountId) {
    if (await accountStillExists(existing.stripeAccountId)) return existing.stripeAccountId;
    console.warn(`[connect] ${creatorId}: stored account ${existing.stripeAccountId} is unknown to this platform key — re-provisioning`);
  }

  // Idempotency key keyed to the CREATOR: two concurrent callers (store creation fires this
  // best-effort in the background while the creator can simultaneously tap "Set up payouts") get
  // the SAME Stripe account back instead of each creating a real one. Without it, the loser's
  // account was orphaned — and worse, its id was returned, so the creator onboarded onto an account
  // the DB doesn't reference and their KYC never flipped the stored flags.
  const account = await stripePost(
    '/accounts',
    {
      type: 'express',
      email,
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      business_profile: { product_description: 'Creator clothing brand on Nano Crew' },
      metadata: { creatorId },
    },
    // The key is namespaced by the account being replaced: a heal must NOT replay the original
    // request and hand back the very account we just found to be dead.
    existing.stripeAccountId ? `connect_acct_${creatorId}_after_${existing.stripeAccountId}` : `connect_acct_${creatorId}`,
  );
  const stripeAccountId = account.id as string;
  // Upsert, not insert-ignore: on a heal the row already exists and must be repointed, with the
  // capability flags reset — the new account has submitted nothing yet.
  await db
    .insert(schema.connectedAccounts)
    .values({ creatorId, stripeAccountId })
    .onConflictDoUpdate({
      target: schema.connectedAccounts.creatorId,
      set: { stripeAccountId, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false },
    });
  // Return what the DB actually holds — if a concurrent insert won, that row is the truth.
  const settled = await getConnectedAccount(creatorId);
  return settled.stripeAccountId ?? stripeAccountId;
}

/** Where Stripe returns a creator after Connect onboarding — the **platform-api** host, same as
 *  billing's success/cancel pages.
 *
 *  Every Stripe-facing landing page lives on platform-api on purpose: it keeps the money surfaces
 *  off the app bundle (isolating them from Apple's rules) and gives one web host that serves iOS,
 *  Android and web alike. `connect/return` + `connect/refresh` are served there next to
 *  `billing/success`.
 *
 *  Normalized the way `billing.ts` does it — a host-only env var (no scheme) makes Stripe reject
 *  the account link outright. */
function connectReturnBase(): string {
  let base = (process.env.BILLING_RETURN_URL ?? process.env.PLATFORM_API_BASE ?? 'https://nanocrew.app')
    .trim()
    .replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  return base;
}

/** A Stripe-hosted onboarding link for the creator to finish identity/bank verification. */
export async function createOnboardingLink(stripeAccountId: string): Promise<string> {
  const base = connectReturnBase();
  const link = await stripePost('/account_links', {
    account: stripeAccountId,
    refresh_url: `${base}/connect/refresh`,
    return_url: `${base}/connect/return`,
    type: 'account_onboarding',
  });
  return link.url as string;
}

/** Live status + what Stripe still wants. `requirementsDue`/`disabledReason` are TRANSIENT — read
 *  fresh from Stripe each time, never persisted (no schema change; they'd only go stale anyway). */
export interface ConnectLiveStatus extends ConnectStatus {
  /** Stripe requirement keys still outstanding (e.g. 'individual.id_number') — empty when clear. */
  requirementsDue: string[];
  /** Why charges/payouts are off, when Stripe says so (e.g. 'requirements.past_due'). */
  disabledReason: string | null;
}

/** Pull the live capability flags from Stripe and persist them (also called by the webhook path). */
export async function refreshConnectedAccount(creatorId: string): Promise<ConnectLiveStatus> {
  const current = await getConnectedAccount(creatorId);
  if (!current.stripeAccountId) return { ...current, requirementsDue: [], disabledReason: null };
  // A stored id that this platform key doesn't know (test-mode leftover, rotated platform account)
  // must read as "not set up yet" — otherwise the status call 502s and the creator is shown an
  // error instead of the button that would fix it. ensureConnectedAccount re-provisions on click.
  if (!(await accountStillExists(current.stripeAccountId))) {
    return { ...NO_ACCOUNT, requirementsDue: [], disabledReason: null };
  }
  const acct = await stripeGet(`/accounts/${current.stripeAccountId}`);
  const req = (acct.requirements ?? {}) as { currently_due?: string[]; past_due?: string[]; disabled_reason?: string | null };
  const status: ConnectLiveStatus = {
    stripeAccountId: current.stripeAccountId,
    chargesEnabled: !!acct.charges_enabled,
    payoutsEnabled: !!acct.payouts_enabled,
    detailsSubmitted: !!acct.details_submitted,
    requirementsDue: [...new Set([...(req.past_due ?? []), ...(req.currently_due ?? [])])],
    disabledReason: req.disabled_reason ?? null,
  };
  await db
    .update(schema.connectedAccounts)
    .set({ chargesEnabled: status.chargesEnabled, payoutsEnabled: status.payoutsEnabled, detailsSubmitted: status.detailsSubmitted })
    .where(eq(schema.connectedAccounts.creatorId, creatorId));
  return status;
}

/** A one-time login link to the creator's Express dashboard — where a VERIFIED creator manages
 *  their bank account and sees payout history. Only valid for accounts that completed onboarding;
 *  callers should fall back to an onboarding link otherwise. */
export async function createExpressLoginLink(stripeAccountId: string): Promise<string> {
  const link = await stripePost(`/accounts/${stripeAccountId}/login_links`, {});
  return link.url as string;
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

/** Transfer a held order's net to the brand's connected account, then mark it released.
 *
 *  RE-GUARDED HERE, not just at scan time: the release job scans a batch and then works through it
 *  with awaits, so minutes can pass between "this order was held" and "transfer it" — long enough
 *  for a refund to land and mark the order 'skipped'. Without the re-check the transfer went out
 *  anyway and the final write clobbered 'skipped' back to 'released': the brand got paid for a
 *  refunded order. So: re-read immediately before the transfer, and make every state write
 *  conditional on payoutStatus still being 'held' — a concurrent refund's write wins, never ours.
 *  The per-order Stripe idempotency key remains the backstop against double-pay on retries. */
export async function releasePayout(order: ReleasablePayout): Promise<void> {
  const [fresh] = await db
    .select({ payoutStatus: schema.orders.payoutStatus })
    .from(schema.orders)
    .where(eq(schema.orders.id, order.id))
    .limit(1);
  if (fresh?.payoutStatus !== 'held') return; // refunded/settled since the scan — not ours to touch

  if (!order.connectedAccountId || order.brandNetCents <= 0 || !order.stripeChargeId) {
    // Nothing transferable (no destination, zero net, or no source charge). 'skipped' — the honest
    // state: no transfer was ever sent. It used to write 'released', and a later refund would then
    // "reverse" a transfer that never existed, recording 'reversed' for a no-op.
    await db
      .update(schema.orders)
      .set({ payoutStatus: 'skipped' })
      .where(and(eq(schema.orders.id, order.id), eq(schema.orders.payoutStatus, 'held')));
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
    .where(and(eq(schema.orders.id, order.id), eq(schema.orders.payoutStatus, 'held')));
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
 *
 *  THE SAME RULE THE MONEY PATH ENFORCES (BUG_AUDIT_2026-08-20 #37). platform-api's checkout
 *  refuses any brand without a charges-enabled account — unconditionally, because checkout is
 *  public and reachable by slug — with one bypass: PLATFORM_SETTLED_SLUGS (platform-owned demo
 *  stores). This gate used to opt out whenever STRIPE_CONNECT_ENABLED was unset, so the documented
 *  rollback would have let creators publish shops whose every checkout 409s. It now mirrors
 *  checkout exactly, including the bypass — so PLATFORM_SETTLED_SLUGS must be set in BOTH
 *  environments. The one remaining escape is Stripe not being configured at all, where checkout
 *  503s anyway and publishing is moot. */
export async function goLiveBlockReason(creatorId: string, slug?: string): Promise<string | null> {
  if (!process.env.STRIPE_SECRET_KEY) return null; // payments stack off entirely (dev)
  const settled = (process.env.PLATFORM_SETTLED_SLUGS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (slug && settled.includes(slug)) return null;
  const status = await getConnectedAccount(creatorId);
  if (!status.stripeAccountId) return 'finish setting up payments before going live';
  if (!status.chargesEnabled) return 'your payment setup is still pending — finish it before going live';
  return null;
}
