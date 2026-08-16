import Stripe from 'stripe';

// One platform Stripe account for now — every store's checkout settles here and
// creators are paid out manually. Stripe Connect (per-creator accounts with an
// application fee) is the production model; the orders schema already carries
// application_fee_cents for that day.
const key = process.env.STRIPE_SECRET_KEY;

export const stripe = key ? new Stripe(key) : null;
export const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';
// The CONNECT-scoped endpoint's secret. `account.updated` for Express accounts is only delivered to
// a webhook endpoint created with connect=true, and that endpoint signs with its OWN secret — the
// account-scoped WEBHOOK_SECRET can never verify those events (which made the account.updated
// handler dead code until 2026-08-16: the platform endpoint wasn't even subscribed to it).
export const CONNECT_WEBHOOK_SECRET = process.env.STRIPE_CONNECT_WEBHOOK_SECRET ?? '';
