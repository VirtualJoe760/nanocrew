import { and, eq, inArray } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

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
    blurb: 'Publish a brand store in the Nanocrew app and buy credits to create.',
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
    priceCents: 14900, // $149/mo
    monthlyCredits: 12000,
    maxBrands: 99,
    website: true,
    creditRateMultiplier: 0.8, // 20% better rate on credit top-ups
    priceEnv: 'STRIPE_PRICE_ADVANCED',
    blurb: 'The most credits and the best rate on top-ups, plus website + domain.',
  },
};

// One-time credit packs (web prices). In-app packs cost more to cover Apple's IAP cut —
// that markup is applied in the client, not here.
export const CREDIT_PACKS: { id: string; credits: number; priceCents: number; label: string }[] = [
  { id: 'pack_500', credits: 500, priceCents: 500, label: '500 credits' },
  { id: 'pack_1500', credits: 1500, priceCents: 1200, label: '1,500 credits' },
  { id: 'pack_5000', credits: 5000, priceCents: 3500, label: '5,000 credits' },
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

/** The creator's current entitlements — free (cannot launch) unless a paid plan is active. */
export async function getEntitlements(creatorId: string): Promise<Entitlements> {
  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.creatorId, creatorId))
    .limit(1);
  if (!sub || sub.plan === 'free') return FREE_ENTITLEMENTS;
  const active = (ACTIVE_STATUSES as readonly string[]).includes(sub.status);
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
  const base = process.env.BILLING_RETURN_URL ?? process.env.PLATFORM_API_BASE ?? 'https://nanocrew.app';
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
          product_data: { name: `Nanocrew — ${pack.label}` },
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
