import { apiUrl } from '@/lib/api';

// Client seam for Apple In-App Purchase of credit packs. The native StoreKit module
// (react-native-iap) is NOT installed yet — it requires a dev/production build (it can't
// run in Expo Go) plus App Store Connect products. Until then `iapAvailable()` returns
// false and the Paywall falls back to web Stripe. The server verify endpoint
// (/api/creator/billing/iap-verify) is already live; wiring this on means:
//   1. `npx expo install react-native-iap` (+ its config plugin) and make a dev build,
//   2. set `IAP_ENABLED` true below and implement buyCreditsIap's StoreKit calls,
//   3. create the consumable products in App Store Connect (see src/lib/iap-products.ts).
// We deliberately do NOT `require('react-native-iap')` here — a static require of a
// missing module would break Metro's bundler. Flip this once the dep is installed.
const IAP_ENABLED = false;

/** True only on a real iOS build with the native IAP module wired — never in Expo Go. */
export function iapAvailable(): boolean {
  return IAP_ENABLED;
}

/**
 * Purchase a credit pack via StoreKit, then hand the receipt to the server for
 * verification + credit grant. Throws 'iap_unavailable' until the native module + a dev
 * build exist. The server side (/api/creator/billing/iap-verify) is already implemented.
 */
export async function buyCreditsIap(_productId: string, _token: string): Promise<{ granted: number; balance: number | null }> {
  if (!iapAvailable()) throw new Error('iap_unavailable');
  // TODO (needs react-native-iap + dev build + App Store Connect products):
  //   1. const IAP = require('react-native-iap'); await IAP.initConnection();
  //   2. await IAP.requestPurchase({ sku: _productId });
  //   3. const receipt = await IAP.getReceiptIOS();  (base64 app receipt)
  //   4. POST receipt → /api/creator/billing/iap-verify → finishTransaction.
  const res = await fetch(apiUrl('/api/creator/billing/iap-verify'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${_token}` },
    body: JSON.stringify({ receipt: '', productId: _productId }),
  });
  return (await res.json()) as { granted: number; balance: number | null };
}
