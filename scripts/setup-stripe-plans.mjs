// Create the Nanocrew subscription plans in Stripe via the API (the "digital services" catalog),
// the same way Printful products are created via API. One Product + one monthly recurring Price per
// plan, then it prints the STRIPE_PRICE_* env lines to paste into the app + platform-api.
//
// Idempotent: products are matched by metadata, prices by a stable lookup_key — re-running reuses
// what exists and only creates a new price when the amount changed.
//
// Usage: node scripts/setup-stripe-plans.mjs        (reads STRIPE_SECRET_KEY from .env.local)
//
// Plans MUST mirror TIERS in src/lib/billing.ts.
import fs from 'node:fs';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const KEY = env.match(/^STRIPE_SECRET_KEY=(.+)$/m)?.[1]?.trim();
if (!KEY) throw new Error('STRIPE_SECRET_KEY not found in .env.local');

const PLANS = [
  { plan: 'starter', envVar: 'STRIPE_PRICE_STARTER', name: 'Nanocrew Starter', priceCents: 1000, blurb: 'Publish a brand store in the Nanocrew app and buy credits to create.' },
  { plan: 'pro', envVar: 'STRIPE_PRICE_PRO', name: 'Nanocrew Pro', priceCents: 5000, blurb: 'Your own storefront website + a custom domain, plus more monthly credits.' },
  { plan: 'advanced', envVar: 'STRIPE_PRICE_ADVANCED', name: 'Nanocrew Advanced', priceCents: 14900, blurb: 'The most credits and the best rate on top-ups, plus website + domain.' },
];

const BASE = 'https://api.stripe.com/v1';
const auth = { Authorization: `Bearer ${KEY}` };

function form(params, prefix = '') {
  const parts = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') parts.push(form(v, key));
    else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return parts.filter(Boolean).join('&');
}

async function api(method, path, params) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...auth, ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    ...(params ? { body: form(params) } : {}),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json.error?.message ?? ''}`);
  return json;
}

async function productFor(plan, name) {
  // Search by our metadata tag so re-runs don't make duplicate products.
  const found = await api('GET', `/products/search?query=${encodeURIComponent(`metadata['nanocrew_plan']:'${plan}'`)}&limit=1`);
  if (found.data?.length) return found.data[0].id;
  const created = await api('POST', '/products', { name, metadata: { nanocrew_plan: plan } });
  return created.id;
}

async function priceFor(plan, productId, priceCents) {
  const lookupKey = `nanocrew_${plan}_monthly`;
  const existing = await api('GET', `/prices?lookup_keys[]=${encodeURIComponent(lookupKey)}&active=true&limit=1`);
  const match = existing.data?.[0];
  if (match && match.unit_amount === priceCents && match.recurring?.interval === 'month') return match.id;
  // New plan or the amount changed (Stripe prices are immutable) → create and move the lookup key.
  const created = await api('POST', '/prices', {
    product: productId,
    unit_amount: priceCents,
    currency: 'usd',
    recurring: { interval: 'month' },
    lookup_key: lookupKey,
    transfer_lookup_key: true,
    metadata: { nanocrew_plan: plan },
  });
  return created.id;
}

console.log('Creating Nanocrew plans in Stripe…\n');
const lines = [];
for (const p of PLANS) {
  const productId = await productFor(p.plan, p.name);
  const priceId = await priceFor(p.plan, productId, p.priceCents);
  console.log(`  ${p.name.padEnd(20)} $${(p.priceCents / 100).toFixed(2)}/mo  product=${productId}  price=${priceId}`);
  lines.push(`${p.envVar}=${priceId}`);
}

console.log('\nDone. Add these to .env.local AND the platform-api Vercel project:\n');
console.log(lines.join('\n'));
console.log('\n(Credit packs stay inline price_data with the per-plan rate, so they need no Stripe products.)');
