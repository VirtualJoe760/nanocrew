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

// ── Core sender (raw fetch → Resend; env-gated; never throws) ─────────────────────────────────────

async function sendEmail(input: {
  store: EmailStore;
  to: string;
  subject: string;
  heading: string;
  body: string;
  cta?: EmailCta;
  preheader?: string;
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
    const from = buildBrandSender(input.store);
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
