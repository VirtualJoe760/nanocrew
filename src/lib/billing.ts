import { and, eq, inArray } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { isCompCreator } from '@/lib/comp';

// Subscriptions gate launching a store; credits meter AI spend. This module owns the tier
// definitions, the entitlement lookup, and Stripe Checkout session creation (web). We talk
// to Stripe over plain REST (form-encoded) so the Expo app needs no Stripe SDK — the
// signature-verifying webhook lives in platform-api where the SDK already is.

export type PaidPlan = 'starter' | 'pro' | 'advanced';
export type Plan = 'free' | PaidPlan;

export interface TierDef {
  plan: PaidPlan;
  label: string;
  priceCents: number; // monthly, web price (IAP is pricier — handled client-side)
  monthlyCredits: number; // granted on each successful invoice
  maxBrands: number; // how many stores this creator may launch
  website: boolean; // gets a real storefront website (+ custom domain) — Pro and up
  creditRateMultiplier: number; // discount applied to credit-pack prices (1 = list, 0.8 = 20% off)
  priceEnv: string; // env var holding the recurring Stripe Price id
  blurb: string;
}

// Plan ladder: Starter sells in-app; Pro adds a website + custom domain; Advanced adds the most
// credits and the best top-up rate. Credit allotments track each tier's headroom over real AI cost.
export const TIERS: Record<PaidPlan, TierDef> = {
  starter: {
    plan: 'starter',
    label: 'Starter',
    priceCents: 1000, // $10/mo
    monthlyCredits: 500,
    maxBrands: 1,
    website: false,
    creditRateMultiplier: 1,
    priceEnv: 'STRIPE_PRICE_STARTER',
    blurb: 'Publish a brand store in the Nano Crew app and buy credits to create.',
  },
  pro: {
    plan: 'pro',
    label: 'Pro',
    priceCents: 5000, // $50/mo
    monthlyCredits: 3000,
    maxBrands: 3,
    website: true,
    creditRateMultiplier: 1,
    priceEnv: 'STRIPE_PRICE_PRO',
    blurb: 'Your own storefront website + a custom domain, plus more monthly credits.',
  },
  advanced: {
    plan: 'advanced',
    label: 'Advanced',
    priceCents: 17500, // $175/mo (web/Stripe; in-app Apple price is higher — set in App Store Connect)
    monthlyCredits: 12000,
    maxBrands: 99,
    website: true,
    creditRateMultiplier: 1, // no pack discount — value comes from the larger monthly allotment
    priceEnv: 'STRIPE_PRICE_ADVANCED',
    blurb: 'The most monthly credits, plus website + domain.',
  },
};

// One-time credit packs. A credit is a flat $0.01 everywhere (no volume discount) — that $0.01 is
// the profitability FLOOR every generation charge is sized against (≥2× our API cost at $0.01/cr).
// Plan allotments give a better effective rate; packs do not. In-app (Apple IAP) packs cost more to
// cover Apple's cut — that markup is applied in the client, not here.
export const CREDIT_PACKS: { id: string; credits: number; priceCents: number; label: string }[] = [
  { id: 'pack_500', credits: 500, priceCents: 500, label: '500 credits' }, // $0.010/cr
  { id: 'pack_1500', credits: 1500, priceCents: 1500, label: '1,500 credits' }, // $0.010/cr
  { id: 'pack_5000', credits: 5000, priceCents: 5000, label: '5,000 credits' }, // $0.010/cr
];

const ACTIVE_STATUSES = ['active', 'trialing'] as const;

export interface Entitlements {
  plan: Plan;
  status: string;
  active: boolean; // an active/trialing PAID plan
  maxBrands: number;
  monthlyCredits: number;
  website: boolean; // may provision a storefront website + attach a domain (Pro and up)
  creditRateMultiplier: number; // discount on credit-pack purchases (1 = list price)
  currentPeriodEnd: Date | null;
}

const FREE_ENTITLEMENTS: Entitlements = {
  plan: 'free',
  status: 'none',
  active: false,
  maxBrands: 0,
  monthlyCredits: 0,
  website: false,
  creditRateMultiplier: 1,
  currentPeriodEnd: null,
};

// Comp / internal accounts get top-tier access for free (and never get charged credits — see
// credits.ts). It makes no sense to bill ourselves.
const COMP_ENTITLEMENTS: Entitlements = {
  plan: 'advanced',
  status: 'comp',
  active: true,
  maxBrands: 9999,
  monthlyCredits: 0, // credit charges are skipped for comp accounts, so no monthly grant needed
  website: true,
  creditRateMultiplier: 1,
  currentPeriodEnd: null,
};

/** The creator's current entitlements — free (cannot launch) unless a paid plan is active. */
export async function getEntitlements(creatorId: string): Promise<Entitlements> {
  if (await isCompCreator(creatorId)) return COMP_ENTITLEMENTS;
  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.creatorId, creatorId))
    .limit(1);
  if (!sub || sub.plan === 'free') return FREE_ENTITLEMENTS;
  // Apple IAP subscriptions have no Stripe webhook flipping status at period end, so we treat them
  // as lapsed once currentPeriodEnd passes (re-verifying on launch re-activates a renewal). Stripe
  // subs keep their own status/period fresh via the billing webhook, so leave those to status.
  const isApple = sub.stripeCustomerId?.startsWith('apple:') ?? false;
  const lapsed = isApple && sub.currentPeriodEnd != null && sub.currentPeriodEnd.getTime() < Date.now();
  const active = (ACTIVE_STATUSES as readonly string[]).includes(sub.status) && !lapsed;
  const tier = TIERS[sub.plan as PaidPlan];
  return {
    plan: sub.plan as Plan,
    status: sub.status,
    active,
    maxBrands: active ? tier.maxBrands : 0,
    monthlyCredits: tier.monthlyCredits,
    website: active && tier.website,
    creditRateMultiplier: active ? tier.creditRateMultiplier : 1,
    currentPeriodEnd: sub.currentPeriodEnd,
  };
}

/** How many stores the creator already has — used against the tier's brand cap. */
export async function countBrands(creatorId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.stores.id })
    .from(schema.stores)
    .where(eq(schema.stores.creatorId, creatorId));
  return rows.length;
}

export function monthlyCreditsForPlan(plan: PaidPlan): number {
  return TIERS[plan].monthlyCredits;
}

/** Upsert the creator's subscription from an Apple IAP auto-renewable purchase. We reuse the
 *  (Stripe-named) identity columns: stripeSubscriptionId holds Apple's originalTransactionId
 *  (unique per subscription) and stripeCustomerId is tagged `apple:<otid>`. Renewals/cancels
 *  arrive via App Store Server Notifications V2 (platform-api), mirroring the Stripe webhook. */
export async function upsertAppleSubscription(input: {
  creatorId: string;
  plan: PaidPlan;
  status: 'active' | 'canceled' | 'past_due';
  originalTransactionId: string;
  currentPeriodEnd: Date | null;
}): Promise<void> {
  const values = {
    plan: input.plan,
    status: input.status,
    stripeCustomerId: `apple:${input.originalTransactionId}`,
    stripeSubscriptionId: input.originalTransactionId,
    currentPeriodEnd: input.currentPeriodEnd,
  };
  const [existing] = await db
    .select({ id: schema.subscriptions.id })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.creatorId, input.creatorId))
    .limit(1);
  if (existing) {
    await db.update(schema.subscriptions).set(values).where(eq(schema.subscriptions.id, existing.id));
  } else {
    await db.insert(schema.subscriptions).values({ creatorId: input.creatorId, ...values });
  }
}

export interface LaunchCheck {
  ok: boolean;
  reason?: 'subscription_required' | 'brand_limit';
  entitlements: Entitlements;
  brandCount: number;
}

/** Gate for launching a store: needs an active paid plan AND room under the brand cap. */
export async function canLaunchStore(creatorId: string): Promise<LaunchCheck> {
  const entitlements = await getEntitlements(creatorId);
  const brandCount = await countBrands(creatorId);
  if (!entitlements.active) return { ok: false, reason: 'subscription_required', entitlements, brandCount };
  if (brandCount >= entitlements.maxBrands) return { ok: false, reason: 'brand_limit', entitlements, brandCount };
  return { ok: true, entitlements, brandCount };
}

// ---------- Stripe Checkout (web) over REST ----------

const STRIPE_BASE = 'https://api.stripe.com/v1';

function stripeKey(): string {
  const k = process.env.STRIPE_SECRET_KEY;
  if (!k) throw new Error('STRIPE_SECRET_KEY missing');
  return k;
}

/** Encode a nested params object the way Stripe's form API expects (a[b][c]=v). */
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
    headers: {
      Authorization: `Bearer ${stripeKey()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: encode(params),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (json.error as { message?: string } | undefined)?.message ?? 'stripe error';
    throw new Error(msg);
  }
  return json;
}

function urls() {
  // Stripe rejects a success_url without an http(s) scheme — and a host-only env var (common on
  // Railway) would 502 the whole checkout. Normalize to a valid absolute https URL.
  let base = (process.env.BILLING_RETURN_URL ?? process.env.PLATFORM_API_BASE ?? 'https://nanocrew.app').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  return { success: `${base}/billing/success`, cancel: `${base}/billing/cancel` };
}

/** Reuse the creator's Stripe customer if we have one, else create one keyed to their id. */
async function ensureCustomer(creatorId: string, email: string): Promise<string> {
  const [sub] = await db
    .select({ stripeCustomerId: schema.subscriptions.stripeCustomerId })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.creatorId, creatorId))
    .limit(1);
  if (sub?.stripeCustomerId) return sub.stripeCustomerId;
  const customer = await stripePost('/customers', { email, 'metadata[creatorId]': creatorId });
  return customer.id as string;
}

/** A Stripe Checkout Session URL for subscribing to a tier. */
export async function createSubscriptionCheckout(creatorId: string, email: string, plan: PaidPlan): Promise<string> {
  const tier = TIERS[plan];
  const priceId = process.env[tier.priceEnv];
  if (!priceId) throw new Error(`${tier.priceEnv} not configured`);
  const customer = await ensureCustomer(creatorId, email);
  const { success, cancel } = urls();
  const session = await stripePost('/checkout/sessions', {
    mode: 'subscription',
    customer,
    'line_items': { 0: { price: priceId, quantity: 1 } },
    success_url: `${success}?plan=${plan}`,
    cancel_url: cancel,
    'metadata': { creatorId, plan, kind: 'subscription' },
    'subscription_data': { 'metadata': { creatorId, plan } },
  });
  return session.url as string;
}

/** A Stripe Checkout Session URL for a one-time credit pack. Higher tiers get a better rate:
 *  the buyer's plan `creditRateMultiplier` discounts the pack price (Advanced = 20% off). */
export async function createCreditPackCheckout(creatorId: string, email: string, packId: string): Promise<string> {
  const pack = CREDIT_PACKS.find((p) => p.id === packId);
  if (!pack) throw new Error('unknown pack');
  const { creditRateMultiplier } = await getEntitlements(creatorId);
  const unitAmount = Math.round(pack.priceCents * creditRateMultiplier);
  const customer = await ensureCustomer(creatorId, email);
  const { success, cancel } = urls();
  const session = await stripePost('/checkout/sessions', {
    mode: 'payment',
    customer,
    'line_items': {
      0: {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: unitAmount,
          product_data: { name: `Nano Crew — ${pack.label}` },
        },
      },
    },
    success_url: `${success}?credits=${pack.credits}`,
    cancel_url: cancel,
    'metadata': { creatorId, kind: 'credit_pack', packId, credits: pack.credits },
    payment_intent_data: { 'metadata': { creatorId, kind: 'credit_pack', credits: pack.credits } },
  });
  return session.url as string;
}

/** A Stripe Customer Portal URL where the creator can manage/cancel/update their plan +
 *  card. Returns null if they have no Stripe customer yet (never subscribed/topped up). */
export async function createBillingPortalSession(creatorId: string): Promise<string | null> {
  const [sub] = await db
    .select({ stripeCustomerId: schema.subscriptions.stripeCustomerId })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.creatorId, creatorId))
    .limit(1);
  if (!sub?.stripeCustomerId) return null;
  const { cancel } = urls();
  const session = await stripePost('/billing_portal/sessions', { customer: sub.stripeCustomerId, return_url: cancel });
  return (session.url as string) ?? null;
}

/** Stores referenced elsewhere — kept here so callers can show "2 of 3 brands". */
export async function brandsOwnedIn(creatorIds: string[]): Promise<Record<string, number>> {
  if (!creatorIds.length) return {};
  const rows = await db
    .select({ creatorId: schema.stores.creatorId })
    .from(schema.stores)
    .where(and(inArray(schema.stores.creatorId, creatorIds)));
  const out: Record<string, number> = {};
  for (const r of rows) out[r.creatorId] = (out[r.creatorId] ?? 0) + 1;
  return out;
}
