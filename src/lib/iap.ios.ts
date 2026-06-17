import {
  fetchProducts,
  finishTransaction,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
} from 'react-native-iap';

import { apiUrl } from '@/lib/api';
import { ALL_IAP_PRODUCT_IDS } from '@/lib/iap-products';

// iOS StoreKit 2 client (react-native-iap v15, Nitro). Purchases are EVENT-BASED: requestPurchase
// dispatches, and the result arrives via purchaseUpdatedListener / purchaseErrorListener. We bind
// the purchase to the creator via appAccountToken (their Supabase user id, decoded from the JWT),
// send Apple's transactionId to /api/creator/billing/iap-verify (App Store Server API verification),
// then finishTransaction. Any failure resolves cleanly so the Paywall can fall back to web Stripe.

export interface IapResult {
  ok: boolean;
  balance?: number | null;
  error?: string;
}

let initialized = false;
async function ensureInit(): Promise<boolean> {
  if (initialized) return true;
  try {
    await initConnection();
    initialized = true;
    return true;
  } catch {
    return false;
  }
}

// IAP is "ready" only if the native connection opens AND App Store Connect has our products —
// before the products exist the Paywall should stay on web Stripe.
export async function iapReady(): Promise<boolean> {
  if (!(await ensureInit())) return false;
  try {
    const products = await fetchProducts({ skus: ALL_IAP_PRODUCT_IDS, type: 'all' });
    return Array.isArray(products) && products.length > 0;
  } catch {
    return false;
  }
}

// Decode the Supabase user id (the JWT `sub`) for Apple's appAccountToken (must be a UUID — it is).
function userIdFromToken(token: string): string | undefined {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(global.atob(part)) as { sub?: string };
    return typeof json.sub === 'string' ? json.sub : undefined;
  } catch {
    return undefined;
  }
}

export async function purchaseInApp(opts: {
  productId: string;
  isSubscription: boolean;
  token: string;
}): Promise<IapResult> {
  if (!(await ensureInit())) return { ok: false, error: 'iap_unavailable' };
  const appAccountToken = userIdFromToken(opts.token);

  return new Promise<IapResult>((resolve) => {
    let settled = false;
    const finish = (r: IapResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      updateSub.remove();
      errorSub.remove();
      resolve(r);
    };

    const updateSub = purchaseUpdatedListener(async (purchase) => {
      const transactionId = purchase.transactionId ?? purchase.id;
      if (!transactionId) return;
      try {
        const res = await fetch(apiUrl('/api/creator/billing/iap-verify'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.token}` },
          body: JSON.stringify({ transactionId }),
        });
        const d = (await res.json().catch(() => null)) as { ok?: boolean; balance?: number | null; error?: string } | null;
        if (res.ok && d?.ok) {
          // Consumables (credit packs) must be consumed so they can be re-bought; subs are not.
          await finishTransaction({ purchase, isConsumable: !opts.isSubscription }).catch(() => {});
          finish({ ok: true, balance: d.balance ?? null });
        } else {
          finish({ ok: false, error: d?.error ?? 'verify_failed' });
        }
      } catch (e) {
        finish({ ok: false, error: e instanceof Error ? e.message : 'verify_failed' });
      }
    });

    const errorSub = purchaseErrorListener((err) => {
      const code = (err as { code?: string } | null)?.code;
      finish({ ok: false, error: code === 'E_USER_CANCELLED' ? 'cancelled' : (err?.message ?? 'purchase_failed') });
    });

    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), 120_000);

    // v15 Nitro arg shape: { request: { apple: { sku, appAccountToken } }, type }. The union is
    // narrowed by `type`, so we build per-branch to satisfy it.
    const applePurchase = { sku: opts.productId, ...(appAccountToken ? { appAccountToken } : {}) };
    const dispatch = opts.isSubscription
      ? requestPurchase({ request: { apple: applePurchase }, type: 'subs' })
      : requestPurchase({ request: { apple: applePurchase }, type: 'in-app' });
    dispatch.catch((e: unknown) => finish({ ok: false, error: e instanceof Error ? e.message : 'purchase_failed' }));
  });
}
