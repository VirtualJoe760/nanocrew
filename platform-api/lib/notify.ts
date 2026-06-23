// The Nano Crew transactional-email service. ONE central sender for every branded shopper email
// across the order lifecycle, on behalf of each brand from no-reply-{slug}@mail-nano-crew.com.
//
// Provider: Resend, REUSED — we POST to the Resend REST API by hand (no SDK / no new mailer dep).
// Env-gated: when RESEND_API_KEY or the sending domain is unset we log-and-no-op so non-prod stays
// inert. Every send is BEST-EFFORT and NEVER throws into its caller — an ESP outage must not break a
// webhook 200, a checkout, or a creator action. See docs/accounts/EMAIL_PIPELINE.md for the lifecycle
// catalogue (which trigger fires which email) and the owner config (DNS, Resend domain verification).

import {
  renderEmail,
  esc,
  p,
  ul,
  money,
  link,
  type EmailStore,
  type EmailCta,
} from '@/lib/email-templates';

export type { EmailStore } from '@/lib/email-templates';

const RESEND_URL = 'https://api.resend.com/emails';

// ── Per-brand sender ────────────────────────────────────────────────────────────────────────────

/**
 * "Nano Crew × {Brand} <no-reply-{slug}@mail-nano-crew.com>".
 *
 * All brands share the one verified sending domain (MAIL_DOMAIN, default mail-nano-crew.com); only
 * the local-part varies by sanitized slug. Falls back to the global EMAIL_FROM when MAIL_DOMAIN is
 * unset so the system stays inert/safe in environments without the domain configured.
 */
export function buildBrandSender(store: { slug: string; name: string }): string {
  const domain = process.env.MAIL_DOMAIN;
  if (!domain) {
    // No verified sending domain configured → use the global from verbatim (or a safe default).
    return process.env.EMAIL_FROM ?? 'Nano Crew <onboarding@resend.dev>';
  }
  const slug = (store.slug || 'shop').toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '') || 'shop';
  // Strip characters that would break the RFC5322 display name; keep it readable.
  const display = `Nano Crew × ${(store.name || 'Nano Crew').replace(/[<>"\r\n]/g, '').trim()}`.trim();
  return `${display} <no-reply-${slug}@${domain}>`;
}

/**
 * The platform's own sender — "Nano Crew <no-reply@{domain}>". Used for CREATOR-facing notifications
 * (new sale, payout, subscription/credit receipts, brand-live), which come FROM Nano Crew TO the
 * creator, as opposed to the per-brand shopper emails above. Falls back to EMAIL_FROM when unset.
 */
export function buildPlatformSender(): string {
  const domain = process.env.MAIL_DOMAIN;
  if (!domain) return process.env.EMAIL_FROM ?? 'Nano Crew <onboarding@resend.dev>';
  return `Nano Crew <no-reply@${domain}>`;
}

/** Nano Crew's own brand surface for platform emails — clean monochrome (the template defaults). */
const PLATFORM_STORE: EmailStore = { slug: 'nanocrew', name: 'Nano Crew', logoUrl: null, colors: null };

const PLAN_LABEL: Record<string, string> = { free: 'Free', starter: 'Starter', pro: 'Pro', advanced: 'Advanced' };
function planLabel(plan: string): string {
  return PLAN_LABEL[plan] ?? plan.charAt(0).toUpperCase() + plan.slice(1);
}

// ── Core sender (raw fetch → Resend; env-gated; never throws) ─────────────────────────────────────

async function sendEmail(input: {
  store: EmailStore;
  to: string;
  subject: string;
  heading: string;
  body: string;
  cta?: EmailCta;
  preheader?: string;
  /** Override the From (e.g. the Nano Crew platform sender for creator-facing emails). */
  from?: string;
}): Promise<void> {
  try {
    const key = process.env.RESEND_API_KEY;
    // The send is gated on BOTH the key and a configured sending domain (MAIL_DOMAIN, with EMAIL_FROM
    // as the legacy global fallback). Without either we stay inert and log what we would have sent.
    const haveFrom = Boolean(process.env.MAIL_DOMAIN || process.env.EMAIL_FROM);
    if (!key || !haveFrom) {
      console.log(`[notify] email unconfigured — would send "${input.subject}" to ${input.to} for ${input.store.name}`);
      return;
    }
    const from = input.from ?? buildBrandSender(input.store);
    const html = renderEmail({
      store: input.store,
      heading: input.heading,
      body: input.body,
      cta: input.cta,
      preheader: input.preheader,
    });
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, html }),
    });
    if (!res.ok) {
      console.error(`[notify] resend failed (${input.subject} → ${input.to}): ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
  } catch (e) {
    // Best-effort: never propagate. A failed send must not break the webhook/checkout/creator action.
    console.error('[notify]', e instanceof Error ? e.message : e);
  }
}

// ── Shared opt shapes (checked at every platform-api caller — webhooks, public/returns, internal) ──

/** A `return_requests` row slice the email needs (live-read; pass what the route already loaded). */
export type ReturnRequestLike = {
  id: string;
  reason: 'defective' | 'damaged' | 'wrong_item' | 'not_received' | string;
  note?: string | null;
  resolution?: string | null;
};

/** An `orders` row slice the email needs. */
export type OrderLike = {
  id: string;
  totalCents?: number | null;
  currency?: string | null;
};

const REASON_LABEL: Record<string, string> = {
  defective: 'defective item',
  damaged: 'damaged in transit',
  wrong_item: 'wrong item received',
  not_received: 'package not received',
};
function reasonLabel(reason: string): string {
  return REASON_LABEL[reason] ?? reason.replace(/_/g, ' ');
}

/** Short, human order reference from the order id (full uuid is noise in an email). */
function orderRef(orderId: string): string {
  return `#${orderId.slice(0, 8).toUpperCase()}`;
}

// ── Lifecycle emails (the contract A/B/C build against) ───────────────────────────────────────────

/** #2 Order confirmation — fired from checkout.session.completed. Discloses the returns window. */
export async function sendOrderConfirmation(opts: {
  to: string;
  store: EmailStore;
  items: string[];
  order: OrderLike;
}): Promise<void> {
  const total = typeof opts.order.totalCents === 'number'
    ? p(`Order total: ${money(opts.order.totalCents, opts.order.currency ?? 'USD')}`, { muted: true })
    : '';
  await sendEmail({
    store: opts.store,
    to: opts.to,
    subject: `Your ${opts.store.name} order is confirmed`,
    heading: 'Order confirmed — thank you.',
    preheader: `${opts.store.name} is making your order ${orderRef(opts.order.id)}.`,
    body:
      p(`Thanks for your order with ${esc(opts.store.name)}. We're putting it into production now — you'll get tracking the moment it ships.`, { html: true }) +
      p(`Order ${orderRef(opts.order.id)}`) +
      ul(opts.items) +
      total +
      p(`Made to order. If something arrives defective, damaged, wrong, or doesn't show up, you have a 7-day return window from the ship date — just reply or use the returns link on the store.`, { muted: true }),
  });
}

/**
 * #3 Shipped + tracking — fired from the printful-webhook package_shipped branch.
 * Switched to the per-brand sender (now takes `store`); kept backward-usable by A's webhook.
 */
export async function sendShippedEmail(opts: {
  to: string;
  store: EmailStore;
  items: string[];
  trackingNumber?: string | null;
  trackingUrl?: string | null;
}): Promise<void> {
  const tracking = opts.trackingUrl
    ? p(`${link('Track your package', opts.trackingUrl)}${opts.trackingNumber ? ` — ${esc(opts.trackingNumber)}` : ''}`, { html: true })
    : opts.trackingNumber
      ? p(`Tracking number: ${esc(opts.trackingNumber)}`, { html: true })
      : '';
  await sendEmail({
    store: opts.store,
    to: opts.to,
    subject: `Your ${opts.store.name} order is on its way`,
    heading: 'Your order shipped.',
    preheader: `${opts.store.name} just shipped your order.`,
    cta: opts.trackingUrl ? { label: 'Track your package', url: opts.trackingUrl } : undefined,
    body:
      p(`${opts.items.join(', ')} — made to order by ${esc(opts.store.name)}, now headed your way.`, { html: true }) +
      tracking,
  });
}

/** #4 Delivered + review request — fired on the ship+N delivery proxy / window-close path. */
export async function sendDeliveredReviewRequest(opts: {
  to: string;
  store: EmailStore;
  order: OrderLike;
  reviewUrl?: string;
}): Promise<void> {
  await sendEmail({
    store: opts.store,
    to: opts.to,
    subject: `How's your ${opts.store.name} order?`,
    heading: 'Hope you love it.',
    preheader: `Tell ${opts.store.name} what you think.`,
    cta: opts.reviewUrl ? { label: 'Leave a review', url: opts.reviewUrl } : undefined,
    body:
      p(`Your order ${orderRef(opts.order.id)} from ${esc(opts.store.name)} should have arrived. We'd love to hear how it turned out.`, { html: true }) +
      p(`If anything wasn't right — defective, damaged, or wrong — reply and we'll make it right.`, { muted: true }),
  });
}

/** #5 Return requested (buyer ack) — fired from POST /api/public/returns. */
export async function sendReturnRequested(opts: {
  to: string;
  store: EmailStore;
  returnRequest: ReturnRequestLike;
}): Promise<void> {
  await sendEmail({
    store: opts.store,
    to: opts.to,
    subject: `We received your return request`,
    heading: 'Return request received.',
    preheader: `${opts.store.name} is reviewing your claim.`,
    body:
      p(`Thanks — we've logged your return request with ${esc(opts.store.name)} (reason: ${esc(reasonLabel(opts.returnRequest.reason))}).`, { html: true }) +
      p(`The brand will review it shortly and you'll hear back by email. Reference ${orderRef(opts.returnRequest.id)}.`),
  });
}

/** #6 Return approved — fired from the creator approve action (often bundled with the refund). */
export async function sendReturnApproved(opts: {
  to: string;
  store: EmailStore;
  returnRequest: ReturnRequestLike;
}): Promise<void> {
  const note = opts.returnRequest.resolution ? p(esc(opts.returnRequest.resolution), { muted: true }) : '';
  await sendEmail({
    store: opts.store,
    to: opts.to,
    subject: `Your return was approved`,
    heading: 'Your return is approved.',
    preheader: `${opts.store.name} approved your return.`,
    body:
      p(`Good news — ${esc(opts.store.name)} approved your return request (${esc(reasonLabel(opts.returnRequest.reason))}).`, { html: true }) +
      p(`Your refund is being processed; you'll get a separate confirmation once it's issued.`) +
      note,
  });
}

/** #8 Return declined — fired from the creator decline action, with the reason. */
export async function sendReturnDeclined(opts: {
  to: string;
  store: EmailStore;
  returnRequest: ReturnRequestLike;
  reason?: string;
}): Promise<void> {
  const why = opts.reason ?? opts.returnRequest.resolution;
  await sendEmail({
    store: opts.store,
    to: opts.to,
    subject: `An update on your return request`,
    heading: 'Update on your return.',
    preheader: `${opts.store.name} reviewed your return request.`,
    body:
      p(`${esc(opts.store.name)} has reviewed your return request and is unable to approve it at this time.`, { html: true }) +
      (why ? p(`Reason: ${esc(why)}`, { html: true }) : '') +
      p(`If you think this was a mistake or have more details (photos help), reply to this email and we'll take another look.`, { muted: true }),
  });
}

/** #7 Refund confirmation — fired when a refund is issued (approve path + charge.refunded). */
export async function sendRefundConfirmation(opts: {
  to: string;
  store: EmailStore;
  order: OrderLike;
  amountCents: number;
}): Promise<void> {
  await sendEmail({
    store: opts.store,
    to: opts.to,
    subject: `Your refund has been issued`,
    heading: 'Refund issued.',
    preheader: `${money(opts.amountCents, opts.order.currency ?? 'USD')} refunded by ${opts.store.name}.`,
    body:
      p(`A refund of ${esc(money(opts.amountCents, opts.order.currency ?? 'USD'))} for order ${orderRef(opts.order.id)} has been issued by ${esc(opts.store.name)}.`, { html: true }) +
      p(`It typically takes 5–10 business days to appear on your statement, depending on your bank.`, { muted: true }),
  });
}

// ── Creator / platform emails (FROM Nano Crew TO the creator) ──────────────────────────────────────
// These notify the brand OWNER about account activity. Unlike the shopper emails above they render
// against the Nano Crew monochrome surface and send from the platform sender, not the per-brand one.

/** Creator new-sale notification — fired from the commerce stripe-webhook once an order is paid. */
export async function sendCreatorSale(opts: {
  to: string;
  brandName: string;
  items: string[];
  order: OrderLike;
}): Promise<void> {
  const total = typeof opts.order.totalCents === 'number'
    ? p(`Order total: ${money(opts.order.totalCents, opts.order.currency ?? 'USD')}`, { muted: true })
    : '';
  await sendEmail({
    store: PLATFORM_STORE,
    from: buildPlatformSender(),
    to: opts.to,
    subject: `You made a sale on ${opts.brandName} 🎉`,
    heading: 'You made a sale.',
    preheader: `A new order just came in for ${opts.brandName}.`,
    body:
      p(`Nice — someone just ordered from ${esc(opts.brandName)}.`, { html: true }) +
      p(`Order ${orderRef(opts.order.id)}`) +
      ul(opts.items) +
      total +
      p(`Nano Crew handles production and fulfilment automatically. Your payout for this order releases after the return window closes.`, { muted: true }),
  });
}

/** Creator payout notification — fired when a held payout is released to the connected account. */
export async function sendPayoutNotification(opts: {
  to: string;
  brandName: string;
  amountCents: number;
  currency?: string | null;
  order: OrderLike;
}): Promise<void> {
  await sendEmail({
    store: PLATFORM_STORE,
    from: buildPlatformSender(),
    to: opts.to,
    subject: `A payout is on the way`,
    heading: 'Payout on the way.',
    preheader: `${money(opts.amountCents, opts.currency ?? 'USD')} from ${opts.brandName} is being transferred.`,
    body:
      p(`Your payout of ${esc(money(opts.amountCents, opts.currency ?? 'USD'))} for ${esc(opts.brandName)} (order ${orderRef(opts.order.id)}) is being transferred to your connected account.`, { html: true }) +
      p(`It typically lands in your bank within a couple of business days, depending on your bank and payout schedule.`, { muted: true }),
  });
}

/** Subscription receipt / renewal — fired from billing-webhook invoice.paid. */
export async function sendSubscriptionReceipt(opts: {
  to: string;
  plan: string;
  amountCents: number;
  currency?: string | null;
  renewal?: boolean;
}): Promise<void> {
  const label = planLabel(opts.plan);
  await sendEmail({
    store: PLATFORM_STORE,
    from: buildPlatformSender(),
    to: opts.to,
    subject: `Your Nano Crew ${label} subscription`,
    heading: opts.renewal ? 'Subscription renewed.' : 'You’re subscribed.',
    preheader: `${label} — ${money(opts.amountCents, opts.currency ?? 'USD')}.`,
    body:
      p(`Thanks for subscribing to Nano Crew ${esc(label)}.`, { html: true }) +
      p(`Amount: ${esc(money(opts.amountCents, opts.currency ?? 'USD'))}`, { html: true }) +
      p(`Your monthly credits have been added to your account. Manage your plan anytime from Account → billing.`, { muted: true }),
  });
}

/** Subscription payment-failed (dunning) — fired from billing-webhook invoice.payment_failed. */
export async function sendPaymentFailed(opts: {
  to: string;
  plan: string;
  updateUrl?: string;
}): Promise<void> {
  const label = planLabel(opts.plan);
  await sendEmail({
    store: PLATFORM_STORE,
    from: buildPlatformSender(),
    to: opts.to,
    subject: `Your Nano Crew payment didn’t go through`,
    heading: 'Payment failed.',
    preheader: `We couldn’t process your ${label} subscription payment.`,
    cta: opts.updateUrl ? { label: 'Update payment method', url: opts.updateUrl } : undefined,
    body:
      p(`We weren’t able to process the payment for your Nano Crew ${esc(label)} subscription.`, { html: true }) +
      p(`Please update your payment method to keep your plan active — we’ll retry automatically. If the payment keeps failing your plan may be paused.`, { muted: true }),
  });
}

/** Credit-purchase receipt — fired from billing-webhook on a Stripe credit-pack checkout. */
export async function sendCreditReceipt(opts: {
  to: string;
  credits: number;
  amountCents: number;
  currency?: string | null;
}): Promise<void> {
  await sendEmail({
    store: PLATFORM_STORE,
    from: buildPlatformSender(),
    to: opts.to,
    subject: `Your Nano Crew credit top-up`,
    heading: 'Credits added.',
    preheader: `${opts.credits.toLocaleString()} credits added to your account.`,
    body:
      p(`${esc(opts.credits.toLocaleString())} credits have been added to your Nano Crew account.`, { html: true }) +
      p(`Amount: ${esc(money(opts.amountCents, opts.currency ?? 'USD'))}`, { html: true }) +
      p(`Credits power AI design, model shots, and video generation. Happy creating.`, { muted: true }),
  });
}

/** Brand-live announcement — fired when a store is first published (app-only or with a domain). */
export async function sendBrandLive(opts: {
  to: string;
  brandName: string;
  url: string;
}): Promise<void> {
  await sendEmail({
    store: PLATFORM_STORE,
    from: buildPlatformSender(),
    to: opts.to,
    subject: `${opts.brandName} is live 🚀`,
    heading: 'Your store is live.',
    preheader: `${opts.brandName} is open for business.`,
    cta: { label: 'Visit your store', url: opts.url },
    body:
      p(`${esc(opts.brandName)} is now live and open for orders.`, { html: true }) +
      p(`Share your link, post your products, and start selling. You can keep editing your site and adding products anytime — just talk to Venus.`, { muted: true }),
  });
}
