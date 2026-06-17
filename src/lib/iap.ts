// Non-iOS (web / Android) fallback for the IAP seam. There is no native StoreKit here, so
// `iapReady()` is always false and callers (the Paywall) use web Stripe checkout instead.
// The real StoreKit 2 implementation lives in iap.ios.ts — Metro resolves that for iOS builds,
// and this file for everything else, so react-native-iap is never bundled off-iOS.

export interface IapResult {
  ok: boolean;
  balance?: number | null;
  error?: string;
}

/** True only on a real iOS build with the native IAP module + App Store products available. */
export async function iapReady(): Promise<boolean> {
  return false;
}

/** Why IAP isn't ready — only meaningful on iOS (see iap.ios.ts). */
export function iapDetail(): string {
  return 'non-iOS';
}

/** Purchase a plan (subscription) or credit pack via Apple IAP. Unavailable off-iOS. */
export async function purchaseInApp(_opts: {
  productId: string;
  isSubscription: boolean;
  token: string;
}): Promise<IapResult> {
  return { ok: false, error: 'iap_unavailable' };
}
