# Transactional email pipeline

Every branded email Nano Crew sends a **shopper** across the order lifecycle — and how a single
central service sends them on behalf of each brand from `no-reply-{slug}@mail-nano-crew.com`. Read
this before adding any email send. Pairs with [RETURNS_REFUNDS.md](RETURNS_REFUNDS.md) (the lifecycle
that fires these) and [ORDERS.md](ORDERS.md).

## Provider & the one fact to anchor on

- **Resend, reused — do NOT add a new mailer.** `platform-api/lib/notify.ts` *already* POSTs to the
  Resend REST API by hand (`fetch https://api.resend.com/emails`), env-gated on `RESEND_API_KEY` +
  `EMAIL_FROM`, logging-and-returning when unset. It currently exports exactly one function
  (`sendShippedEmail`) wired to one event. **Generalize this one file** into the email service.
- **One verified sending domain: `mail-nano-crew.com`.** All brands share it (one SPF/DKIM/DMARC,
  one Resend domain verification). The brand only varies the **local-part**.
- **Email is best-effort.** A send must NEVER throw into its caller — an ESP outage cannot break a
  webhook 200 or a checkout. Wrap every send in try/catch-and-log (mirror `src/lib/notify.ts`'s
  `notifyRevisionReady` pattern). When unconfigured, log and no-op (current behaviour) so non-prod
  stays inert.

## Per-brand sender · `buildBrandSender(store)`

```ts
// "Nano Crew × {Brand} <no-reply-{slug}@mail-nano-crew.com>"
buildBrandSender({ slug, name }: { slug: string; name: string }): string
```

- `slug` (sanitized `[a-z0-9-]`) is the only thing that varies the address; the brand `name` comes
  from the **brand-identity cascade** (`stores.name` — never hand-pull one surface; see
  [brand-identity invariant](../architecture/ARCHITECTURE.md)).
- Falls back to the global `EMAIL_FROM` when `MAIL_DOMAIN` is unset, so the system stays inert/safe
  in environments without the domain configured.

## The email service — function contract · `platform-api/lib/notify.ts`

This is the interface the webhook + returns hooks build against. Each takes the resolved order +
store and is best-effort:

```ts
sendOrderConfirmation({ to, store, items, order })        // checkout.session.completed
sendShippedEmail({ to, store, items, trackingNumber, trackingUrl })  // EXISTS — keep, add `store`
sendDeliveredReviewRequest({ to, store, order, reviewUrl }) // delivery / review-request
sendReturnRequested({ to, store, returnRequest })          // buyer ack on claim opened
sendReturnApproved({ to, store, returnRequest })           // claim approved
sendReturnDeclined({ to, store, returnRequest, reason })   // claim declined
sendRefundConfirmation({ to, store, order, amountCents })  // refund issued
```

Each: resolve `from = buildBrandSender(store)`, render the shared branded layout, POST to Resend,
log on `!res.ok`. Keep the raw-`fetch` core (no SDK dependency required).

## Branded layout — emails mirror the Nano Crew pattern, per brand

A shared HTML layout (`renderEmail({ store, heading, body, cta? })`) takes the brand's **name, logo,
and colors** — pulled from the cascade (`stores.logo_url` + `site_config` copy/colors, **live-read,
no rebuild**) so each brand's mail matches its storefront, with a consistent Nano Crew footer
("Sent by Nano Crew on behalf of {brand}"). Keep it inline-styled, table-based, ≤600px (email-client
reality). React-Email/MJML is optional polish; a single well-tested HTML template is the floor.

## Lifecycle catalogue — every email, its trigger, its hook point

| # | Email | Trigger · file | Notes |
|---|---|---|---|
| 1 | **Account verification / welcome** | Supabase Auth signup | Today: Supabase default SMTP (unbranded, off-domain). Move to Supabase **custom SMTP → Resend** + branded templates so it originates from `mail-nano-crew.com`. Dashboard config — see "Owner config" |
| 2 | **Order confirmation** | `checkout.session.completed` · `stripe-webhook/route.ts` | New. Discloses the returns policy + window. The webhook already loads order + email + items |
| 3 | **Shipped + tracking** | `package_shipped` · `printful-webhook/route.ts` | **Exists** (`sendShippedEmail`). Add `store` for per-brand sender/branding |
| 4 | **Delivered + review request** | delivery branch · `printful-webhook` (or the release path) | New. With ship+7d there's no carrier "delivered" event in v1 — fire on a `shippedAt + N` proxy or alongside window close. Asks for a review/feedback |
| 5 | **Return requested (ack)** | `POST /api/public/returns` | New. Confirms the claim, sets expectations |
| 6 | **Return approved** | creator approve · `/api/creator/returns/[id]/approve` | New. Often bundled with #7 |
| 7 | **Refund confirmation** | refund issued (approve path **and** `charge.refunded` for dashboard refunds) | New. Both code-initiated and Stripe-dashboard refunds should notify |
| 8 | **Return declined** | creator decline | New. With the reason |

Hook points already load order + store + items, so recipient + per-brand `from` are derivable with
**no schema change** (`orders.customerEmail` + `stores.name/slug/logo_url`).

## Central vs per-brand split

- **Central (platform-api):** the email service, sender authentication, all secrets, every lifecycle
  hook. **Templates never send mail** (thin-client rule).
- **Per-brand (data only):** the from-address local-part (`slug`), the brand name/logo/colors in the
  layout (from the cascade), and the returns-policy copy. No per-brand secrets, no per-brand code.

## Auth emails (#1) — Supabase custom SMTP

Account verification + password reset are sent by **Supabase**, not this codebase. To brand them and
originate from `mail-nano-crew.com`: configure **Supabase → Auth → SMTP** to relay through Resend and
replace the default email templates with branded ones. This is **dashboard config (owner)**, not a
webhook code path — flag it, don't try to intercept Supabase's send in code.

## Owner config (outside the repo — gates whether any email actually sends)

1. **DNS for `mail-nano-crew.com`:** SPF, DKIM, DMARC + **Resend domain verification**. Until this is
   done, branded mail risks spam-foldering — a hard dependency before email is non-inert.
2. **Env:** `RESEND_API_KEY`, `MAIL_DOMAIN=mail-nano-crew.com` (+ keep `EMAIL_FROM` as the global
   fallback). Both currently unset in prod → the service logs-and-no-ops, safely.
3. **Supabase custom SMTP** (for auth emails #1) + branded auth templates.
4. Turn off the redundant Stripe receipt once #2 (order confirmation) is live, if desired.

## Docs discipline

Adding/changing a lifecycle email updates **this** catalogue in the same change. Register new
endpoints in [API.md](../architecture/API.md); the returns lifecycle lives in
[RETURNS_REFUNDS.md](RETURNS_REFUNDS.md).
