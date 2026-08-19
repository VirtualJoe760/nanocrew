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
// Nano Crew's OWN emails wear Nano Crew — the NC monogram, the app's palette (cool monochrome +
// platinum silver, no gold — AGENTS.md) and its typeface. They used to render as the generic
// fallback: no logo, no colours, indistinguishable from any other transactional mail (Joe,
// 2026-08-19: "they do not have our logo, or our fonts etc").
// Values are the app's tokens via nanocrew-site/app/globals.css, not invented here.
const PLATFORM_STORE: EmailStore = {
  slug: 'nanocrew',
  name: 'Nano Crew',
  logoUrl: 'https://nanocrew.app/nc-icon.png',
  colors: {
    page: '#08080a',       // --bg
    card: '#131317',       // --surface
    ink: '#f4f4f6',        // --text
    muted: '#8b909b',      // --dim
    accent: '#cdd1d9',     // --accent, the platinum: CTA button
    onAccent: '#08080a',   // dark ink reads on platinum
    line: '#212127',       // --edge
    headerBg: '#08080a',   // the masthead is the app's night — the monogram is light-on-black
    headerInk: '#f4f4f6',
  },
};

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
      p(`Share your link, post your products, and start selling. You can keep editing your site and adding products anytime — just talk to Eve.`, { muted: true }),
  });
}

/**
 * Collaborator invite — fired from the internal notify route when a creator invites someone to
 * co-run a brand. Sent from the PLATFORM sender: it's Nano Crew brokering the introduction, not a
 * shopper email from the brand. The invite keys on EMAIL (the invitee may have no account yet — see
 * db/schema.ts storeInvites), so the copy covers both doors: the accept link for anyone with the
 * email, and the sign-in-with-this-email path where the invite waits under Account in the app.
 */
export async function sendCollabInvite(opts: {
  to: string;
  inviterName: string | null;
  brandName: string;
  acceptUrl: string;
}): Promise<void> {
  const inviter = opts.inviterName ?? 'A Nano Crew creator';
  await sendEmail({
    store: PLATFORM_STORE,
    from: buildPlatformSender(),
    to: opts.to,
    subject: `${inviter} invited you to collaborate on ${opts.brandName}`,
    heading: 'You’re invited.',
    preheader: `Join ${opts.brandName} on Nano Crew.`,
    cta: { label: 'View invitation', url: opts.acceptUrl },
    body:
      p(`${esc(inviter)} invited you to collaborate on ${esc(opts.brandName)} — design products and manage the brand together on Nano Crew.`, { html: true }) +
      p(`No app yet? The invite also appears under Account in the Nano Crew app when you sign in with this email address.`, { muted: true }),
  });
}

// ── Beta signups (nanocrew.app → public/beta-signup) ──────────────────────────────────────────────

const STORE_LABEL: Record<string, string> = { ios: 'TestFlight', android: 'Google Play' };

/**
 * Their confirmation — "you're in". Only sent once the address is actually on the tester list, so
 * it never promises a build that isn't coming. TestFlight sends its own invite separately; this is
 * the email that explains what just landed in their inbox.
 */
export async function sendBetaApproved(opts: { to: string; platform: 'ios' | 'android' }): Promise<void> {
  const store = STORE_LABEL[opts.platform];
  await sendEmail({
    store: PLATFORM_STORE,
    from: buildPlatformSender(),
    to: opts.to,
    subject: 'You’re in the Nano Crew beta',
    heading: 'You’re in.',
    preheader: `Your ${store} invite is on its way.`,
    body:
      p(`You have a place in the Nano Crew beta. Your ${esc(store)} invite is on its way to this address — accept it and the app installs like any other.`, { html: true }) +
      p(`Nano Crew turns a conversation into a clothing brand: talk to Eve, she builds the shop and the website, and you design and sell from your phone.`, { muted: true }) +
      p(`Tell us what breaks. That's what a beta is for — just reply to this email.`, { muted: true }),
  });
}

/**
 * Past the cap. This is the honest version: no slot today, we'll email at launch. Deliberately does
 * NOT dangle a maybe — the waitlist row is what gets mailed when the app goes public.
 */
export async function sendBetaWaitlisted(opts: { to: string; platform: 'ios' | 'android' }): Promise<void> {
  const store = STORE_LABEL[opts.platform];
  await sendEmail({
    store: PLATFORM_STORE,
    from: buildPlatformSender(),
    to: opts.to,
    subject: 'You’re on the Nano Crew list',
    heading: 'You’re on the list.',
    preheader: 'The beta is full — we’ll email you the moment it opens up.',
    body:
      p(`The ${esc(store)} beta is full right now, so we've saved your place. We'll email this address the moment the app is available — you don't need to do anything.`, { html: true }) +
      p(`Nano Crew turns a conversation into a clothing brand: talk to Eve, she builds the shop and the website, and you design and sell from your phone.`, { muted: true }),
  });
}

/** The heads-up to ops: who signed up, whether they got a slot, and how many are left. */
export async function sendBetaSignupAlert(opts: {
  email: string;
  platform: 'ios' | 'android';
  status: 'approved' | 'waitlisted' | 'failed';
  remaining: number;
  note?: string;
}): Promise<void> {
  const to = process.env.OPS_EMAIL;
  if (!to) {
    console.warn('[notify] beta signup (set OPS_EMAIL to receive these by email):', JSON.stringify(opts));
    return;
  }
  const store = STORE_LABEL[opts.platform];
  const headline =
    opts.status === 'approved'
      ? `Added to ${store}`
      : opts.status === 'waitlisted'
        ? `Waitlisted — ${store} is full`
        : `Could NOT be added to ${store}`;
  await sendEmail({
    store: PLATFORM_STORE,
    from: buildPlatformSender(),
    to,
    subject: `Beta signup — ${opts.email} (${store})`,
    heading: headline,
    preheader: `${opts.email} · ${opts.remaining} ${store} slot${opts.remaining === 1 ? '' : 's'} left`,
    body:
      p(`<strong>${esc(opts.email)}</strong> signed up for the ${esc(store)} beta.`, { html: true }) +
      ul([
        `Status: ${opts.status}`,
        `Slots left: ${opts.remaining}`,
        ...(opts.note ? [`Note: ${esc(opts.note)}`] : []),
      ]),
  });
}

/** A user reported Market content (Apple Guideline 1.2 + the INFORM consumer-report mechanism). Routes
 *  to OPS_EMAIL; if unset it's logged so nothing is lost. Best-effort — never throws into the caller. */
export async function sendContentReport(opts: {
  targetType: string;
  slug: string;
  reason: string;
  reporter?: string;
}): Promise<void> {
  const to = process.env.OPS_EMAIL;
  if (!to) {
    console.warn('[notify] content report (set OPS_EMAIL to receive these by email):', JSON.stringify(opts));
    return;
  }
  await sendEmail({
    store: PLATFORM_STORE,
    from: buildPlatformSender(),
    to,
    subject: `⚑ Market report: ${opts.targetType} "${opts.slug}"`,
    heading: 'Content reported',
    preheader: `${opts.targetType} ${opts.slug}`,
    body:
      p(`A user reported content on the Market.`, { html: true }) +
      p(`Type: ${esc(opts.targetType)}<br/>Slug: ${esc(opts.slug)}<br/>Reporter: ${esc(opts.reporter ?? 'unknown')}`, { html: true }) +
      p(`Reason: ${esc(opts.reason)}`, { muted: true, html: true }),
  });
}
