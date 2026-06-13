import { and, eq } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { grant } from '@/lib/credits';
import { creditsForProduct } from '@/lib/iap-products';

// POST /api/creator/billing/iap-verify { receipt, productId } — validate an Apple In-App
// Purchase of a CONSUMABLE credit pack server-side, then grant the credits. Apple requires
// digital goods bought inside the iOS app to use IAP (not Stripe); web checkout stays on
// Stripe. Verification is server-to-server (no native SDK needed here) — but the client
// purchase flow needs a dev build + App Store Connect products to produce the receipt.
//
// Configure APPLE_IAP_SHARED_SECRET (App Store Connect → App → App-Specific Shared Secret).

const PROD_URL = 'https://buy.itunes.apple.com/verifyReceipt';
const SANDBOX_URL = 'https://sandbox.itunes.apple.com/verifyReceipt';

interface AppleReceipt {
  status: number;
  receipt?: { in_app?: { product_id: string; transaction_id: string }[] };
}

async function verifyWithApple(receiptData: string, secret: string): Promise<AppleReceipt> {
  const body = JSON.stringify({ 'receipt-data': receiptData, password: secret, 'exclude-old-transactions': true });
  const call = async (url: string): Promise<AppleReceipt> => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    return (await res.json()) as AppleReceipt;
  };
  let result = await call(PROD_URL);
  // 21007 = this is a sandbox receipt sent to production — retry against sandbox.
  if (result.status === 21007) result = await call(SANDBOX_URL);
  return result;
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const secret = process.env.APPLE_IAP_SHARED_SECRET;
  if (!secret) return Response.json({ error: 'iap_not_configured' }, { status: 501 });

  const body = (await req.json().catch(() => null)) as { receipt?: string; productId?: string } | null;
  if (!body?.receipt) return Response.json({ error: 'receipt required' }, { status: 400 });

  try {
    const result = await verifyWithApple(body.receipt, secret);
    if (result.status !== 0) {
      return Response.json({ error: 'invalid_receipt', appleStatus: result.status }, { status: 402 });
    }

    // Grant credits for every credit-pack transaction in the receipt we haven't already
    // credited (idempotent on Apple's transaction_id).
    const purchases = result.receipt?.in_app ?? [];
    let granted = 0;
    let balance: number | null = null;
    for (const p of purchases) {
      const credits = creditsForProduct(p.product_id);
      if (!credits) continue;
      const [seen] = await db
        .select({ id: schema.creditLedger.id })
        .from(schema.creditLedger)
        .where(and(eq(schema.creditLedger.reason, 'topup'), eq(schema.creditLedger.refId, p.transaction_id)))
        .limit(1);
      if (seen) continue;
      balance = await grant(user.id, credits, 'topup', p.transaction_id);
      granted += credits;
    }

    return Response.json({ granted, balance });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'verify failed' }, { status: 502 });
  }
}
