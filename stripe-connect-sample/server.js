// ─────────────────────────────────────────────────────────────────────────────
// Nanocrew — Stripe Connect sample (Platform model: direct charges + app fee,
// plus a SaaS subscription charged to the connected account).
//
// This is a SELF-CONTAINED reference/testbed — not production. It mirrors exactly
// the integration we'll fold into the real app:
//   • Brand (creator) is onboarded as a Stripe V2 connected account.
//   • Brand publishes products on its own connected account.
//   • Shoppers buy via a DIRECT CHARGE on the brand's account, and Nanocrew takes
//     an application_fee_amount (the marketplace commission).
//   • Nanocrew also charges the brand a SaaS subscription (customer_account = the
//     connected account id) and exposes a billing portal.
//   • Webhooks: THIN events for V2 account requirement/capability changes; regular
//     events for the subscription lifecycle.
//
// Run:  cp .env.example .env  →  fill STRIPE_SECRET_KEY  →  npm i  →  npm run dev
// Open: http://localhost:4242
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import express from 'express';
import Stripe from 'stripe';

// ── Config / env ─────────────────────────────────────────────────────────────
// Helpful errors when a required value is missing, per the brief.
function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing ${name}. Set it in stripe-connect-sample/.env (see .env.example). ` +
        `Get test keys at https://dashboard.stripe.com/test/apikeys`,
    );
  }
  return v;
}

// The Stripe Client — used for ALL Stripe requests below.
// NOTE: do NOT set apiVersion; the SDK pins the version it ships with (2026-05-27.dahlia or later).
// <<< FILL IN: STRIPE_SECRET_KEY (test mode sk_test_…) in .env >>>
const stripeClient = new Stripe(requireEnv('STRIPE_SECRET_KEY'));

const BASE_URL = process.env.BASE_URL || 'http://localhost:4242';
const PORT = Number(process.env.PORT || 4242);

// Marketplace commission taken on each storefront sale (the application fee).
const PLATFORM_FEE_PERCENT = Number(process.env.PLATFORM_FEE_PERCENT || 10);

// The recurring Price the brand subscribes to (your SaaS plan). Create a recurring
// Price in the Stripe Dashboard (Products) and put its id here.
// <<< FILL IN: SAAS_PRICE_ID (price_…) in .env to enable the subscription demo >>>
const SAAS_PRICE_ID = process.env.SAAS_PRICE_ID || '';

// Webhook signing secrets (from `stripe listen` or the Dashboard). Optional for the
// happy-path demo; required for the webhook endpoints to verify signatures.
const ACCOUNT_WEBHOOK_SECRET = process.env.ACCOUNT_WEBHOOK_SECRET || ''; // thin / v2 account events
const SUB_WEBHOOK_SECRET = process.env.SUB_WEBHOOK_SECRET || ''; // regular subscription events

// ── "Database" (in-memory for the sample) ────────────────────────────────────
// Map your app's user/brand → its Stripe connected account id. In the real app
// this is the `connected_accounts` table keyed by creator/store. We DELIBERATELY
// do not store onboarding status — we always read it live from Stripe (per the brief).
const db = {
  // demoUserId -> accountId
  accountByUser: new Map(),
  // TODO(real app): persist subscriptionStatus per brand on subscription webhooks.
  subscriptionStatusByAccount: new Map(),
};
const DEMO_USER = 'demo-brand-1'; // stand-in for the signed-in creator/brand

// ── App ──────────────────────────────────────────────────────────────────────
const app = express();

// Webhook routes need the RAW body to verify signatures, so skip JSON parsing for them.
app.use((req, res, next) => {
  if (req.originalUrl.startsWith('/webhooks/')) return next();
  return express.json()(req, res, next);
});
app.use(express.urlencoded({ extended: true }));

// ── Tiny HTML helpers (brand style: paper / near-black + champagne gold) ─────
const GOLD = '#c9a86a';
function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>
  :root { --gold:${GOLD}; --ink:#15130f; --paper:#faf8f3; --line:#e7e2d6; --dim:#6b6356; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif; }
  .wrap { max-width:760px; margin:0 auto; padding:40px 24px 80px; }
  h1 { font-size:24px; letter-spacing:.02em; margin:0 0 4px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.22em; color:var(--dim); margin:34px 0 12px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:20px; margin:14px 0; }
  .row { display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
  a.btn, button { background:var(--gold); color:#15130f; border:0; border-radius:999px; padding:11px 20px;
    font-weight:600; font-size:14px; cursor:pointer; text-decoration:none; display:inline-block; }
  a.btn.ghost, button.ghost { background:transparent; border:1px solid var(--line); color:var(--ink); }
  input, textarea { width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:10px; font:inherit; margin:6px 0; }
  label { font-size:12px; color:var(--dim); }
  .pill { display:inline-block; padding:3px 10px; border-radius:999px; font-size:12px; font-weight:600; }
  .ok { background:#e6f4ea; color:#1c7c3c; } .warn { background:#fdeede; color:#a85b14; } .muted { background:#f0ede5; color:var(--dim); }
  code { background:#f0ede5; padding:1px 6px; border-radius:6px; font-size:13px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:14px; }
  .prod { border:1px solid var(--line); border-radius:12px; padding:14px; background:#fff; }
  .dim { color:var(--dim); font-size:13px; }
</style></head><body><div class="wrap">${body}</div></body></html>`;
}
const money = (cents, currency = 'usd') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((cents || 0) / 100);

// ─────────────────────────────────────────────────────────────────────────────
// 1) DASHBOARD — the brand's view: onboard, status, create products, subscribe.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/', async (req, res, next) => {
  try {
    const accountId = db.accountByUser.get(DEMO_USER) || null;
    let statusHtml = `<p class="dim">No connected account yet — create one to start onboarding.</p>
      <form method="POST" action="/accounts">
        <div class="row">
          <div style="flex:1"><label>Brand display name</label><input name="display_name" value="Alpha Master" required/></div>
          <div style="flex:1"><label>Contact email</label><input name="contact_email" type="email" value="brand@example.com" required/></div>
        </div>
        <button type="submit">Create connected account</button>
      </form>`;

    if (accountId) {
      // Always read onboarding status LIVE from Stripe (no DB cache), per the brief.
      const s = await getAccountStatus(accountId);
      statusHtml = `
        <p>Connected account: <code>${accountId}</code></p>
        <div class="row">
          <span class="pill ${s.readyToProcessPayments ? 'ok' : 'warn'}">${s.readyToProcessPayments ? 'Payments active' : 'Payments not active'}</span>
          <span class="pill ${s.onboardingComplete ? 'ok' : 'warn'}">${s.onboardingComplete ? 'Onboarding complete' : 'Onboarding due'}</span>
        </div>
        <div class="row" style="margin-top:14px">
          <form method="POST" action="/account-links"><input type="hidden" name="accountId" value="${accountId}"/>
            <button type="submit">${s.onboardingComplete ? 'Update details' : 'Onboard to collect payments'}</button></form>
          <a class="btn ghost" href="/storefront/${accountId}">View storefront →</a>
        </div>`;
    }

    const productForm = accountId
      ? `<h2>Create a product (on the brand's account)</h2>
         <div class="card"><form method="POST" action="/products">
           <input type="hidden" name="accountId" value="${accountId}"/>
           <label>Name</label><input name="name" value="Liberty Hoodie" required/>
           <label>Description</label><input name="description" value="Heavyweight, made to order"/>
           <label>Price (USD)</label><input name="price" type="number" step="0.01" value="64.00" required/>
           <button type="submit">Create product</button>
         </form></div>`
      : '';

    const subSection = accountId
      ? `<h2>SaaS subscription (Nanocrew charges the brand)</h2>
         <div class="card">
           <p class="dim">Charged to the connected account as the customer (<code>customer_account</code>). Fee: your plan price.</p>
           <div class="row">
             <form method="POST" action="/subscribe"><input type="hidden" name="accountId" value="${accountId}"/>
               <button type="submit">${SAAS_PRICE_ID ? 'Subscribe to a plan' : 'Subscribe (set SAAS_PRICE_ID first)'}</button></form>
             <form method="POST" action="/billing-portal"><input type="hidden" name="accountId" value="${accountId}"/>
               <button class="ghost" type="submit">Manage billing</button></form>
           </div>
         </div>`
      : '';

    res.send(
      page(
        'Nanocrew · Connect sample',
        `<h1>Brand dashboard</h1>
         <p class="dim">Platform model · direct charges + a ${PLATFORM_FEE_PERCENT}% application fee · SaaS subscription.</p>
         <h2>Connect onboarding</h2>
         <div class="card">${statusHtml}</div>
         ${productForm}
         ${subSection}`,
      ),
    );
  } catch (e) {
    next(e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2) CREATE CONNECTED ACCOUNT — Stripe V2 Accounts API.
//    Never pass a top-level `type`. Use the configuration/defaults shape below.
//    Full object: https://docs.stripe.com/api/v2/core/accounts/object
// ─────────────────────────────────────────────────────────────────────────────
app.post('/accounts', async (req, res, next) => {
  try {
    const { display_name, contact_email } = req.body;
    const account = await stripeClient.v2.core.accounts.create({
      display_name,
      contact_email,
      identity: { country: 'us' },
      dashboard: 'full', // brand gets a full Stripe dashboard
      defaults: {
        responsibilities: {
          fees_collector: 'stripe', // Stripe deducts processing fees from the brand
          losses_collector: 'stripe', // brand bears refunds/chargebacks (direct-charge model)
        },
      },
      configuration: {
        customer: {}, // lets us charge this account a subscription (customer_account)
        merchant: {
          capabilities: {
            card_payments: { requested: true }, // the brand can accept card payments
          },
        },
      },
    });

    // Persist user → accountId. In the real app: insert into `connected_accounts`.
    db.accountByUser.set(DEMO_USER, account.id);
    res.redirect('/');
  } catch (e) {
    next(e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3) ONBOARDING — Stripe V2 Account Links (hosted onboarding).
// ─────────────────────────────────────────────────────────────────────────────
app.post('/account-links', async (req, res, next) => {
  try {
    const { accountId } = req.body;
    const accountLink = await stripeClient.v2.core.accountLinks.create({
      account: accountId,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          configurations: ['merchant', 'customer'],
          refresh_url: `${BASE_URL}/account-links-refresh?accountId=${accountId}`,
          return_url: `${BASE_URL}/?accountId=${accountId}`,
        },
      },
    });
    res.redirect(accountLink.url); // send the brand to Stripe-hosted onboarding
  } catch (e) {
    next(e);
  }
});

// If the onboarding link expires, just mint a fresh one and bounce back.
app.get('/account-links-refresh', async (req, res, next) => {
  try {
    const accountId = String(req.query.accountId || '');
    const link = await stripeClient.v2.core.accountLinks.create({
      account: accountId,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          configurations: ['merchant', 'customer'],
          refresh_url: `${BASE_URL}/account-links-refresh?accountId=${accountId}`,
          return_url: `${BASE_URL}/?accountId=${accountId}`,
        },
      },
    });
    res.redirect(link.url);
  } catch (e) {
    next(e);
  }
});

// Live onboarding status, read straight from the Accounts API (no DB cache).
async function getAccountStatus(accountId) {
  const account = await stripeClient.v2.core.accounts.retrieve(accountId, {
    include: ['configuration.merchant', 'requirements'],
  });
  const readyToProcessPayments =
    account?.configuration?.merchant?.capabilities?.card_payments?.status === 'active';
  const requirementsStatus = account?.requirements?.summary?.minimum_deadline?.status;
  const onboardingComplete = requirementsStatus !== 'currently_due' && requirementsStatus !== 'past_due';
  return { account, readyToProcessPayments, onboardingComplete, requirementsStatus };
}

// JSON status endpoint (handy for polling from a richer UI).
app.get('/account-status', async (req, res, next) => {
  try {
    const accountId = String(req.query.accountId || db.accountByUser.get(DEMO_USER) || '');
    if (!accountId) return res.status(400).json({ error: 'no accountId' });
    const { readyToProcessPayments, onboardingComplete, requirementsStatus } = await getAccountStatus(accountId);
    res.json({ accountId, readyToProcessPayments, onboardingComplete, requirementsStatus });
  } catch (e) {
    next(e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4) CREATE PRODUCT — on the brand's connected account (Stripe-Account header).
// ─────────────────────────────────────────────────────────────────────────────
app.post('/products', async (req, res, next) => {
  try {
    const { accountId, name, description, price } = req.body;
    const priceInCents = Math.round(parseFloat(price) * 100);
    await stripeClient.products.create(
      {
        name,
        description: description || undefined,
        default_price_data: { unit_amount: priceInCents, currency: 'usd' },
      },
      { stripeAccount: accountId }, // ← the Stripe-Account header: create on the brand's account
    );
    res.redirect('/');
  } catch (e) {
    next(e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5) STOREFRONT — one page per connected account. Lists that brand's products and
//    lets shoppers buy. NOTE: using the accountId in the URL is fine for the demo;
//    in production use your own per-store identifier (slug) and resolve → accountId.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/storefront/:accountId', async (req, res, next) => {
  try {
    const accountId = req.params.accountId;
    const products = await stripeClient.products.list(
      { limit: 20, active: true, expand: ['data.default_price'] },
      { stripeAccount: accountId }, // ← read the brand's products
    );
    const cards = products.data
      .map((p) => {
        const pr = p.default_price; // expanded Price object
        const cents = typeof pr === 'object' && pr ? pr.unit_amount : 0;
        return `<div class="prod">
          <strong>${p.name}</strong>
          <div class="dim">${p.description || ''}</div>
          <div style="margin:8px 0"><strong>${money(cents)}</strong></div>
          <form method="POST" action="/buy">
            <input type="hidden" name="accountId" value="${accountId}"/>
            <input type="hidden" name="priceId" value="${typeof pr === 'object' && pr ? pr.id : ''}"/>
            <button type="submit">Buy</button>
          </form>
        </div>`;
      })
      .join('');
    res.send(
      page(
        'Storefront',
        `<h1>Storefront</h1><p class="dim">Brand <code>${accountId}</code> · checkout is a direct charge with a ${PLATFORM_FEE_PERCENT}% platform fee.</p>
         <a class="btn ghost" href="/">← Dashboard</a>
         <div class="grid" style="margin-top:18px">${cards || '<p class="dim">No products yet — add one from the dashboard.</p>'}</div>`,
      ),
    );
  } catch (e) {
    next(e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6) BUY — DIRECT CHARGE with an application fee, via hosted Checkout.
//    The funds land on the brand's account; Nanocrew's commission splits off.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/buy', async (req, res, next) => {
  try {
    const { accountId, priceId } = req.body;
    // Look up the price so we can compute the application fee from the amount.
    const price = await stripeClient.prices.retrieve(priceId, { stripeAccount: accountId });
    const amount = price.unit_amount || 0;
    const applicationFee = Math.round((amount * PLATFORM_FEE_PERCENT) / 100);

    const session = await stripeClient.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [{ price: priceId, quantity: 1 }],
        payment_intent_data: {
          application_fee_amount: applicationFee, // ← Nanocrew's marketplace commission
        },
        success_url: `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${BASE_URL}/storefront/${accountId}`,
      },
      { stripeAccount: accountId }, // ← direct charge on the brand's account
    );
    res.redirect(session.url);
  } catch (e) {
    next(e);
  }
});

app.get('/success', (req, res) =>
  res.send(page('Thanks!', `<h1>Payment complete 🎉</h1><p class="dim">Session <code>${req.query.session_id || ''}</code></p><a class="btn" href="/">← Dashboard</a>`)),
);

// ─────────────────────────────────────────────────────────────────────────────
// 7) SAAS SUBSCRIPTION — Nanocrew charges the BRAND. With V2 accounts the
//    connected-account id is used as `customer_account` (one id for both).
// ─────────────────────────────────────────────────────────────────────────────
app.post('/subscribe', async (req, res, next) => {
  try {
    const { accountId } = req.body;
    if (!SAAS_PRICE_ID) {
      return res
        .status(400)
        .send(page('Set SAAS_PRICE_ID', `<h1>SAAS_PRICE_ID missing</h1><p>Create a recurring Price in the Stripe Dashboard and set <code>SAAS_PRICE_ID</code> in .env.</p><a class="btn ghost" href="/">← Back</a>`));
    }
    const session = await stripeClient.checkout.sessions.create({
      customer_account: accountId, // ← the connected account is the subscriber
      mode: 'subscription',
      line_items: [{ price: SAAS_PRICE_ID, quantity: 1 }],
      success_url: `${BASE_URL}/?subscribed=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/`,
    });
    res.redirect(session.url);
  } catch (e) {
    next(e);
  }
});

// Billing portal so the brand can manage its subscription.
app.post('/billing-portal', async (req, res, next) => {
  try {
    const { accountId } = req.body;
    const session = await stripeClient.billingPortal.sessions.create({
      customer_account: accountId,
      return_url: `${BASE_URL}/`,
    });
    res.redirect(session.url);
  } catch (e) {
    next(e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 8a) WEBHOOKS — V2 ACCOUNT events are THIN. Verify, then fetch the full event.
//     Listen for requirement + capability changes so you can re-collect info.
//     Local:  stripe listen --thin-events \
//       'v2.core.account[requirements].updated,v2.core.account[configuration.merchant].capability_status_updated,v2.core.account[configuration.customer].capability_status_updated' \
//       --forward-thin-to localhost:4242/webhooks/account
// ─────────────────────────────────────────────────────────────────────────────
app.post('/webhooks/account', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    if (!ACCOUNT_WEBHOOK_SECRET) return res.status(400).send('ACCOUNT_WEBHOOK_SECRET not set');
    const sig = req.headers['stripe-signature'];
    // Verify + parse the THIN event notification. stripe-node renamed parseThinEvent →
    // parseEventNotification (v19+; we're on v22). The notification carries only ids —
    // related_object.id is the account; call notification.fetchEvent() for the full Event.
    const notification = stripeClient.parseEventNotification(req.body, sig, ACCOUNT_WEBHOOK_SECRET);
    const accountId = notification.related_object?.id;

    switch (notification.type) {
      case 'v2.core.account[requirements].updated': {
        // Requirements changed (regulator/network driven). Re-check what's now due.
        const { onboardingComplete, requirementsStatus } = await getAccountStatus(accountId);
        console.log(`[account] ${accountId} requirements → ${requirementsStatus} (complete=${onboardingComplete})`);
        // TODO(real app): if incomplete, nudge the brand to finish onboarding.
        break;
      }
      case 'v2.core.account[configuration.merchant].capability_status_updated':
      case 'v2.core.account[configuration.customer].capability_status_updated': {
        const { readyToProcessPayments } = await getAccountStatus(accountId);
        console.log(`[account] ${accountId} capability updated → payments active=${readyToProcessPayments}`);
        // TODO(real app): flip the store's "can go live" gate on charges_enabled.
        break;
      }
      default:
        console.log(`[account] unhandled ${notification.type}`);
    }
    res.json({ received: true });
  } catch (e) {
    console.error('[webhooks/account]', e.message);
    res.status(400).send(`Webhook error: ${e.message}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 8b) WEBHOOKS — SUBSCRIPTION lifecycle events are REGULAR (not thin).
//     Local:  stripe listen --forward-to localhost:4242/webhooks/subscriptions
// ─────────────────────────────────────────────────────────────────────────────
app.post('/webhooks/subscriptions', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    if (!SUB_WEBHOOK_SECRET) return res.status(400).send('SUB_WEBHOOK_SECRET not set');
    const sig = req.headers['stripe-signature'];
    const event = stripeClient.webhooks.constructEvent(req.body, sig, SUB_WEBHOOK_SECRET);

    switch (event.type) {
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        // For V2 accounts, the subscriber id is on customer_account (acct_…), not customer.
        const accountId = sub.customer_account || sub.customer;
        const price = sub.items?.data?.[0]?.price?.id;
        const status = sub.status; // active | past_due | canceled | paused | …
        db.subscriptionStatusByAccount.set(accountId, status);
        console.log(`[sub] ${accountId} updated → ${status} (price ${price})`);
        // TODO(real app): grant/adjust plan entitlements for this brand.
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const accountId = sub.customer_account || sub.customer;
        db.subscriptionStatusByAccount.set(accountId, 'canceled');
        console.log(`[sub] ${accountId} canceled`);
        // TODO(real app): revoke plan access for this brand.
        break;
      }
      case 'payment_method.attached':
      case 'payment_method.detached':
      case 'customer.updated':
        console.log(`[sub] ${event.type}`);
        // TODO(real app): update stored billing info (treat as billing-only, never auth).
        break;
      default:
        console.log(`[sub] unhandled ${event.type}`);
    }
    res.json({ received: true });
  } catch (e) {
    console.error('[webhooks/subscriptions]', e.message);
    res.status(400).send(`Webhook error: ${e.message}`);
  }
});

// ── Error handler — surface Stripe errors readably ───────────────────────────
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).send(
    page('Error', `<h1>Something went wrong</h1><p class="dim">${(err && err.message) || 'unknown error'}</p><a class="btn ghost" href="/">← Back</a>`),
  );
});

app.listen(PORT, () => console.log(`Nanocrew Connect sample → ${BASE_URL}`));
