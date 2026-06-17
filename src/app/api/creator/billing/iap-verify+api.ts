import { eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { grant } from '@/lib/credits';
import { monthlyCreditsForPlan, upsertAppleSubscription } from '@/lib/billing';
import { creditsForProduct, planForProduct } from '@/lib/iap-products';
import { appStoreConfigured, fetchTransaction, isSubscription } from '@/lib/app-store';

// POST /api/creator/billing/iap-verify { transactionId } — validate an Apple In-App Purchase via
// the App Store Server API (StoreKit 2) and apply it: consumable credit packs grant credits;
// auto-renewable plan products activate the subscription + grant the first month's credits. Apple
// requires digital goods bought inside the iOS app to use IAP; web checkout stays on Stripe.
//
// The client (react-native-iap, StoreKit 2) sets the purchase's appAccountToken to the creator's
// id, so we can bind the transaction to the buyer. Renewals/cancellations arrive separately via
// App Store Server Notifications V2 (platform-api). Idempotent on Apple's transactionId.
//
// Config: APPLE_IAP_KEY_ID, APPLE_IAP_ISSUER_ID, APPLE_IAP_PRIVATE_KEY, APPLE_BUNDLE_ID.

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  if (!appStoreConfigured()) return Response.json({ error: 'iap_not_configured' }, { status: 501 });

  const body = (await req.json().catch(() => null)) as { transactionId?: string } | null;
  if (!body?.transactionId) return Response.json({ error: 'transactionId required' }, { status: 400 });

  try {
    const tx = await fetchTransaction(body.transactionId);
    if (!tx) return Response.json({ error: 'transaction_not_found' }, { status: 402 });
    if (tx.revocationDate) return Response.json({ error: 'transaction_revoked' }, { status: 402 });

    // Bind the purchase to this creator — the client sets appAccountToken to the user's id.
    if (tx.appAccountToken && tx.appAccountToken.toLowerCase() !== user.id.toLowerCase()) {
      return Response.json({ error: 'transaction_owner_mismatch' }, { status: 403 });
    }

    // Already applied? (Apple may re-deliver; the client may re-verify on relaunch.) The ledger
    // refId is Apple's transactionId, so a prior grant for this transaction is our idempotency key.
    const [seen] = await db
      .select({ id: schema.creditLedger.id })
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.refId, tx.transactionId))
      .limit(1);
    if (seen) {
      const [acct] = await db
        .select({ balance: schema.creditAccounts.balance })
        .from(schema.creditAccounts)
        .where(eq(schema.creditAccounts.creatorId, user.id))
        .limit(1);
      return Response.json({ ok: true, alreadyApplied: true, balance: acct?.balance ?? null });
    }

    // Subscription (plan) purchase → activate + grant the month's credits.
    const plan = planForProduct(tx.productId);
    if (plan && isSubscription(tx)) {
      await upsertAppleSubscription({
        creatorId: user.id,
        plan,
        status: 'active',
        originalTransactionId: tx.originalTransactionId,
        currentPeriodEnd: tx.expiresDate ? new Date(tx.expiresDate) : null,
      });
      const credits = monthlyCreditsForPlan(plan);
      const balance = await grant(user.id, credits, 'subscription_grant', tx.transactionId);
      return Response.json({ ok: true, kind: 'subscription', plan, granted: credits, balance });
    }

    // Consumable credit pack → grant credits.
    const credits = creditsForProduct(tx.productId);
    if (credits) {
      const balance = await grant(user.id, credits, 'topup', tx.transactionId);
      return Response.json({ ok: true, kind: 'credits', granted: credits, balance });
    }

    return Response.json({ error: 'unknown_product', productId: tx.productId }, { status: 422 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'verify failed' }, { status: 502 });
  }
}
