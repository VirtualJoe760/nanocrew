# Transactional email pipeline

Every branded email Nano Crew sends a **shopper** across the order lifecycle — and how a single
central service sends them on behalf of each brand from `no-reply-{slug}@send.nanocrew.app`. Read
this before adding any email send. Pairs with [RETURNS_REFUNDS.md](RETURNS_REFUNDS.md) (the lifecycle
that fires these) and [ORDERS.md](ORDERS.md).

## Provider & the one fact to anchor on

- **Resend, reused — do NOT add a new mailer.** `platform-api/lib/notify.ts` POSTs to the Resend REST
  API by hand (`fetch https://api.resend.com/emails`), env-gated on `RESEND_API_KEY` + the sending
  domain, logging-and-returning when unset. It is the **one email service** — both the shopper family
  (per-brand sender) and the creator/platform family (Nano Crew sender) live here. Add new senders to
  this file; never spin up a second mailer.
- **One verified sending domain: `send.nanocrew.app`** (a subdomain of nanocrew.app; DNS on Vercel,
  auto-configured by Resend's integration — **Verified**). All brands share it (one SPF/DKIM/DMARC).
  The brand only varies the **local-part** (`no-reply-{slug}@`); the platform sender is `no-reply@`.
- **Email is best-effort.** A send must NEVER throw into its caller — an ESP outage cannot break a
  webhook 200 or a checkout. Wrap every send in try/catch-and-log (mirror `src/lib/notify.ts`'s
  `notifyRevisionReady` pattern). When unconfigured, log and no-op (current behaviour) so non-prod
  stays inert.

## Per-brand sender · `buildBrandSender(store)`

```ts
// "Nano Crew × {Brand} <no-reply-{slug}@send.nanocrew.app>"
buildBrandSender({ slug, name }: { slug: string; name: string }): string
```

- `slug` (sanitized `[a-z0-9-]`) is the only thing that varies the address; the brand `name` comes
  from the **brand-identity cascade** (`stores.name` — never hand-pull one surface; see
  [brand-identity invariant](../architecture/ARCHITECTURE.md)).
- Falls back to the global `EMAIL_FROM` when `MAIL_DOMAIN` is unset, so the system stays inert/safe
  in environments without the domain configured.

## The email service — function contract · `platform-api/lib/notify.ts`

This is the interface the webhook + returns hooks build against — **implemented**. Each takes the
resolved order + store and is best-effort (wrapped in try/catch, never throws into the caller):

```ts
// ── Shopper family — per-brand sender (no-reply-{slug}@), branded to the storefront ──
sendOrderConfirmation({ to, store, items, order })        // checkout.session.completed
sendShippedEmail({ to, store, items, trackingNumber, trackingUrl })  // per-brand sender (takes `store`)
sendDeliveredReviewRequest({ to, store, order, reviewUrl }) // delivery / review-request
sendReturnRequested({ to, store, returnRequest })          // buyer ack on claim opened
sendReturnApproved({ to, store, returnRequest })           // claim approved
sendReturnDeclined({ to, store, returnRequest, reason })   // claim declined
sendRefundConfirmation({ to, store, order, amountCents })  // refund issued

// ── Creator / platform family — FROM Nano Crew (buildPlatformSender, monochrome) TO the owner ──
sendCreatorSale({ to, brandName, items, order })           // a sale came in (commerce stripe-webhook)
sendPayoutNotification({ to, brandName, amountCents, currency, order }) // held payout released
sendSubscriptionReceipt({ to, plan, amountCents, currency, renewal })   // invoice.paid (first + cycle)
sendPaymentFailed({ to, plan, updateUrl? })                // invoice.payment_failed (dunning)
sendCreditReceipt({ to, credits, amountCents, currency })  // Stripe credit-pack purchase
sendBrandLive({ to, brandName, url })                      // store first published / went live
```

`store` is the live-read brand slice `EmailStore = { slug, name, logoUrl?, colors? }` — pass what the
route already loaded (`stores.slug/name`, plus `stores.logo_url` + `stores.site_config.colors` for
full branding); `returnRequest`/`order` are the typed row slices `ReturnRequestLike`/`OrderLike`
(re-exported from `notify.ts` so platform-api callers get checked shapes).

**Two families, two senders.** Shopper emails are about *a brand's order* and send from the per-brand
`buildBrandSender(store)` (`no-reply-{slug}@`), branded to the storefront. Creator/platform emails are
*Nano Crew telling the owner about account activity* (sale, payout, receipts, brand-live) — they render
against the Nano Crew monochrome surface and send from `buildPlatformSender()` (`no-reply@{domain}`).
The shared `sendEmail` core takes an optional `from` override so platform senders bypass the per-brand
address; everything else (env-gating, best-effort, the shared layout) is identical.

Each: resolve `from = buildBrandSender(store)`, render the shared branded layout, POST to Resend,
log on `!res.ok`, **env-gated no-op** when `RESEND_API_KEY` or the sending domain is unset. Keep the
raw-`fetch` core (no SDK dependency required). The per-email bodies + the layout live in
`platform-api/lib/email-templates.ts` (keeps `notify.ts` to senders).

### App-triggered sends · `POST /api/internal/notify` (INTERNAL_API_KEY-gated)

App-side actions run on the **Cloud Run backend**, where Resend must NOT live (secrets + sender stay
central in platform-api). So the app posts to `platform-api/app/api/internal/notify` (`x-internal-key`
header, constant-time compared against `INTERNAL_API_KEY`; rejects when the env is unset) with a
minimal payload, and the **route resolves** the full context from the id (it has DB access; the app
stays dumb), best-effort (a configured-and-authed call always `202`s — a failed send never fails the
caller's action). Accepted actions:

| Payload | Resolves → sends | Posted by |
|---|---|---|
| `{ action: 'approved'\|'declined', returnId, reason? }` | claim → store → buyer → `sendReturnApproved`/`sendReturnDeclined` | `creator/returns/[id]/approve+api.ts` · `decline+api.ts` |
| `{ action: 'brand_live', slug }` | store → creator → `sendBrandLive` (url = customDomain or `nanocrew.app/b/{slug}`) | `creator/stores/[slug]/publish+api.ts` (first publish only) |
| `{ action: 'payout', orderId }` | order → store → creator → `sendPayoutNotification` | `internal/release-payouts+api.ts` (per released order) |
| `{ action: 'collab_invite', inviteId }` | invite (pending only) → store + inviter → `sendCollabInvite` to the invitee, CTA → `/invite/<token>` on platform-api | `stores/[slug]/collaborators+api.ts` POST |

The app posts via the shared `notifyPlatform(payload)` helper (`src/lib/notify-internal.ts`) — no-ops
in dev when `PLATFORM_API_BASE`/`INTERNAL_API_KEY` are unset. The other emails fire directly from their
platform-api hooks (order-confirmation/refund + **creator-sale** from the Stripe commerce webhook;
**subscription receipt/renewal, payment-failed, credit receipt** from the Stripe billing webhook;
shipped/delivered from the Printful webhook; return-requested ack from `POST /api/public/returns`), so
they don't go through this route.

> Apple IAP credit/subscription purchases (`creator/billing/iap-verify+api.ts`) do **not** send our own
> receipt — Apple emails its own purchase receipt for App Store transactions. Only the Stripe (web)
> path sends `sendCreditReceipt`/`sendSubscriptionReceipt`.

## Branded layout — emails mirror the Nano Crew pattern, per brand

A shared HTML layout (`renderEmail({ store, heading, body, cta? })` in `email-templates.ts`) takes
the brand's **name, logo, and colors** — pulled from the cascade (`stores.logo_url` + `site_config`
colors, **live-read, no rebuild**; the colors map is free-form, so the layout probes the common key
aliases — `accent`/`primary`, `bg`/`background`, `ink`/`text` — and falls back to a clean Nano Crew
monochrome) so each brand's mail matches its storefront, with a consistent Nano Crew footer
("Sent by Nano Crew on behalf of {brand}"). Inline-styled, table-based, ≤600px (email-client
reality). React-Email/MJML is optional polish; a single well-tested HTML template is the floor.

## Lifecycle catalogue — every email, its trigger, its hook point

| # | Email | Trigger · file | Notes |
|---|---|---|---|
| 1 | **Account verification / welcome** | Supabase Auth signup | Today: Supabase default SMTP (unbranded, off-domain). Move to Supabase **custom SMTP → Resend** + branded templates so it originates from `send.nanocrew.app`. Dashboard config — see "Owner config" |
| 2 | **Order confirmation** | `checkout.session.completed` · `stripe-webhook/route.ts` | New. Discloses the returns policy + window. The webhook already loads order + email + items |
| 3 | **Shipped + tracking** | `package_shipped` · `printful-webhook/route.ts` | **Exists** (`sendShippedEmail`). Add `store` for per-brand sender/branding |
| 4 | **Delivered + review request** | delivery branch · `printful-webhook` (or the release path) | New. With ship+7d there's no carrier "delivered" event in v1 — fire on a `shippedAt + N` proxy or alongside window close. Asks for a review/feedback |
| 5 | **Return requested (ack)** | `POST /api/public/returns` | New. Confirms the claim, sets expectations |
| 6 | **Return approved** | creator approve · `/api/creator/returns/[id]/approve` | New. Often bundled with #7 |
| 7 | **Refund confirmation** | refund issued (approve path **and** `charge.refunded` for dashboard refunds) | New. Both code-initiated and Stripe-dashboard refunds should notify |
| 8 | **Return declined** | creator decline | New. With the reason |
| 9 | **Creator new-sale** | `checkout.session.completed` · `stripe-webhook/route.ts` | Platform family. Resolves store → `creators.email`; fires after the buyer confirmation |
| 10 | **Creator payout** | `internal/release-payouts+api.ts` → `/internal/notify` `{payout, orderId}` | Platform family. One per released order (held → transferred) |
| 11 | **Subscription receipt / renewal** | `invoice.paid` · `billing-webhook/route.ts` | Platform family. `billing_reason` distinguishes first invoice vs cycle; keyed off the invoice id (idempotent) |
| 12 | **Subscription payment-failed** | `invoice.payment_failed` · `billing-webhook` | Platform family. Was an **unhandled event** — now also sets the row `past_due` (a dunning logic gap, not just email) |
| 13 | **Credit-purchase receipt** | `checkout.session.completed` (`kind=credit_pack`) · `billing-webhook` | Platform family. Stripe/web only — Apple IAP relies on Apple's own receipt |
| 14 | **Brand live** | `creator/stores/[slug]/publish+api.ts` → `/internal/notify` `{brand_live, slug}` | Platform family. First publish only (`!isPublic` guard) |

Hook points already load order + store + items, so recipient + per-brand `from` are derivable with
**no schema change** (`orders.customerEmail` + `stores.name/slug/logo_url`); creator-family recipient is
`creators.email` via `stores.creator_id`.

## Central vs per-brand split

- **Central (platform-api):** the email service, sender authentication, all secrets, every lifecycle
  hook. **Templates never send mail** (thin-client rule).
- **Per-brand (data only):** the from-address local-part (`slug`), the brand name/logo/colors in the
  layout (from the cascade), and the returns-policy copy. No per-brand secrets, no per-brand code.

## Auth emails (#1) — Supabase custom SMTP

Account verification + password reset are sent by **Supabase**, not this codebase. To brand them and
originate from `send.nanocrew.app`: configure **Supabase → Auth → SMTP** to relay through Resend and
replace the default email templates with branded ones. This is **dashboard config (owner)**, not a
webhook code path — flag it, don't try to intercept Supabase's send in code.

## Owner config (outside the repo — gates whether any email actually sends)

1. **DNS for `send.nanocrew.app`:** ✅ done — SPF/DKIM/DMARC + Resend domain verification (on Vercel).
2. **Supabase custom SMTP → Resend** (auth emails #1): ✅ done + tested (magic-link showed Delivered),
   sender `Nano Crew <no-reply@send.nanocrew.app>`. **New:** the password-reset redirect
   `nanocrew://reset-password` (+ `exp://…/--/reset-password` + web `/reset-password`) must be added to
   Supabase → Auth → Redirect URLs or the reset link won't return into the app.
3. **Env — the remaining blocker (everything in the catalogue is built but inert until set):**
   `RESEND_API_KEY` + `MAIL_DOMAIN=send.nanocrew.app` on the **Vercel `nanocrew-api`** project (the
   webhooks + `/internal/notify`); `INTERNAL_API_KEY` (same value) on **both** Vercel and **Cloud Run**,
   plus `PLATFORM_API_BASE` on Cloud Run so `notifyPlatform` can reach platform-api. Until set, every send
   logs-and-no-ops, safely.
4. Turn off the redundant Stripe receipt once #2 (order confirmation) is live, if desired (and decide
   whether Stripe's native receipts replace #11/#13 or our branded ones do).

## Docs discipline

Adding/changing a lifecycle email updates **this** catalogue in the same change. Register new
endpoints in [API.md](../architecture/API.md); the returns lifecycle lives in
[RETURNS_REFUNDS.md](RETURNS_REFUNDS.md).
