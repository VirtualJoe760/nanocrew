import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';

import { db, schema } from '@/lib/db';
import { stripe } from '@/lib/stripe';
import {
  grantCredits,
  ledgerHas,
  monthlyCreditsFor,
  setSubscriptionStatusByStripeId,
  upsertSubscription,
} from '@/lib/billing';
import { sendCreditReceipt, sendPaymentFailed, sendSubscriptionReceipt } from '@/lib/notify';

// Resolve a creator's email (creator-facing receipts come FROM Nano Crew). Best-effort.
async function creatorEmail(creatorId: string): Promise<string | null> {
  const [c] = await db
    .select({ email: schema.creators.email })
    .from(schema.creators)
    .where(eq(schema.creators.id, creatorId))
    .limit(1);
  return c?.email ?? null;
}

// POST /api/public/billing-webhook — Stripe events for SUBSCRIPTIONS and CREDIT PACKS.
// Separate endpoint + secret from the commerce (order) webhook so the two never interfere.
// Activations happen on checkout.session.completed; monthly credit grants on invoice.paid
// (idempotent via the ledger). Status changes mirror customer.subscription.* events.
const SECRET = process.env.STRIPE_BILLING_WEBHOOK_SECRET ?? '';

// current_period_end moved onto subscription items in the Basil API; read either shape.
function periodEndOf(sub: Stripe.Subscription): Date | null {
  const s = sub as unknown as { current_period_end?: number; items?: { data?: { current_period_end?: number }[] } };
  const ts = s.current_period_end ?? s.items?.data?.[0]?.current_period_end;
  return ts ? new Date(ts * 1000) : null;
}

// invoice.subscription was relocated under parent.subscription_details in the Basil API.
function invoiceSubId(inv: Stripe.Invoice): string | null {
  const i = inv as unknown as {
    subscription?: string | { id: string };
    parent?: { subscription_details?: { subscription?: string | { id: string } } };
  };
  const raw = i.subscription ?? i.parent?.subscription_details?.subscription;
  return typeof raw === 'string' ? raw : (raw?.id ?? null);
}

export async function POST(req: Request) {
  if (!stripe || !SECRET) return Response.json({ error: 'not configured' }, { status: 503 });

  let event: Stripe.Event;
  try {
    const sig = req.headers.get('stripe-signature') ?? '';
    event = await stripe.webhooks.constructEventAsync(await req.text(), sig, SECRET);
  } catch {
    return Response.json({ error: 'bad signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        const kind = s.metadata?.kind;
        const creatorId = s.metadata?.creatorId;
        if (!creatorId) break;

        if (kind === 'credit_pack') {
          const credits = Number(s.metadata?.credits ?? 0);
          // Idempotent on the session id — Stripe may deliver the event more than once. Only email
          // the receipt on the FIRST grant (inside the idempotency guard) so retries don't re-send.
          if (credits > 0 && !(await ledgerHas('topup', s.id))) {
            await grantCredits(creatorId, credits, 'topup', s.id);
            const email = await creatorEmail(creatorId);
            if (email) {
              await sendCreditReceipt({
                to: email,
                credits,
                amountCents: s.amount_total ?? 0,
                currency: s.currency ?? 'usd',
              }).catch((e) => console.error('[billing-webhook] credit receipt:', e));
            }
          }
        } else if (kind === 'subscription') {
          const plan = s.metadata?.plan ?? 'starter';
          const subId = typeof s.subscription === 'string' ? s.subscription : s.subscription?.id;
          let periodEnd: Date | null = null;
          let status = 'active';
          if (subId) {
            const sub = await stripe.subscriptions.retrieve(subId);
            status = sub.status;
            periodEnd = periodEndOf(sub);
          }
          await upsertSubscription({
            creatorId,
            plan,
            status,
            stripeCustomerId: typeof s.customer === 'string' ? s.customer : (s.customer?.id ?? ''),
            stripeSubscriptionId: subId ?? null,
            currentPeriodEnd: periodEnd,
          });
        }
        break;
      }

      case 'invoice.paid': {
        const inv = event.data.object as Stripe.Invoice;
        const subId = invoiceSubId(inv);
        if (!subId) break;
        // Find our row to learn the creator + plan, then grant that month's credits once.
        const [row] = await db
          .select({ creatorId: schema.subscriptions.creatorId, plan: schema.subscriptions.plan })
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.stripeSubscriptionId, subId))
          .limit(1);
        if (!row) break;
        const credits = monthlyCreditsFor(row.plan);
        // Grant + receipt are both keyed off the invoice id (idempotent) so a re-delivered event
        // neither double-grants nor double-emails.
        if (credits > 0 && !(await ledgerHas('subscription_grant', inv.id))) {
          await grantCredits(row.creatorId, credits, 'subscription_grant', inv.id);
          const email = await creatorEmail(row.creatorId);
          if (email) {
            // billing_reason: 'subscription_create' = first invoice, otherwise a renewal cycle.
            const renewal = (inv as unknown as { billing_reason?: string }).billing_reason !== 'subscription_create';
            await sendSubscriptionReceipt({
              to: email,
              plan: row.plan,
              amountCents: inv.amount_paid ?? 0,
              currency: inv.currency ?? 'usd',
              renewal,
            }).catch((e) => console.error('[billing-webhook] sub receipt:', e));
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        // Dunning: a subscription payment failed. Reflect it on our row (past_due) AND email the
        // creator so they can fix their card before the plan lapses. This event was previously
        // unhandled — both the status update and the notification were missing.
        const inv = event.data.object as Stripe.Invoice;
        const subId = invoiceSubId(inv);
        if (!subId) break;
        await setSubscriptionStatusByStripeId(subId, 'past_due');
        const [row] = await db
          .select({ creatorId: schema.subscriptions.creatorId, plan: schema.subscriptions.plan })
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.stripeSubscriptionId, subId))
          .limit(1);
        if (row) {
          const email = await creatorEmail(row.creatorId);
          if (email) {
            await sendPaymentFailed({ to: email, plan: row.plan }).catch((e) =>
              console.error('[billing-webhook] payment failed email:', e),
            );
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        await setSubscriptionStatusByStripeId(sub.id, sub.status, periodEndOf(sub));
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        await setSubscriptionStatusByStripeId(sub.id, 'canceled');
        break;
      }
    }
    return Response.json({ received: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'webhook failed' }, { status: 500 });
  }
}
