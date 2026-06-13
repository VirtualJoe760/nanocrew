import Stripe from 'stripe';

// One platform Stripe account for now — every store's checkout settles here and
// creators are paid out manually. Stripe Connect (per-creator accounts with an
// application fee) is the production model; the orders schema already carries
// application_fee_cents for that day.
const key = process.env.STRIPE_SECRET_KEY;

export const stripe = key ? new Stripe(key) : null;
export const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';
