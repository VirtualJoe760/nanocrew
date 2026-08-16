import { Platform } from 'react-native';

// WEB BILLING — the cheaper rail, and the rules about pointing at it from inside the app.
//
// Two rails exist for the same digital goods (subscriptions + credit packs):
//   · IAP    — required on iOS for digital goods consumed in-app. Apple takes its cut, so the
//              App Store Connect price is set HIGHER to absorb it.
//   · Stripe — the web rail (platform-api). No store cut, so the creator pays less.
// Physical goods (storefront merch) and creator payouts NEVER touch IAP — Apple excludes physical
// goods, and a payout is not a purchase.
//
// ⚠ COMPLIANCE, READ BEFORE CHANGING. Linking from inside the iOS app to an external purchase is
// governed by App Store Review Guideline 3.1.1 ("anti-steering"). What is permitted has moved a
// lot — the 2025 US injunction in Epic v. Apple opened up external link-outs for US storefronts,
// and entitlements differ by app category and region. This is NOT settled knowledge and it is not
// mine to assert: confirm the CURRENT guideline text and your entitlement status before shipping
// this to review.
//
// That is why the affordance is behind a flag. `EXPO_PUBLIC_WEB_BILLING_LINK` off (the default)
// means the app never mentions or links to web pricing on iOS, which is unambiguously compliant.
// Turn it on only once the policy question is answered. Android and web are unaffected either way —
// Google's equivalent rules apply when that app ships, and the flag is per-platform for that reason.

/** Is the app allowed to point at the cheaper web rail on THIS platform right now? */
export function webBillingLinkAllowed(): boolean {
  // Web already IS the web rail; Android has no shipped app yet and is unrestricted by Apple.
  if (Platform.OS !== 'ios') return true;
  return process.env.EXPO_PUBLIC_WEB_BILLING_LINK === '1';
}

/** Apple's cut, as the in-app price multiplier we set in App Store Connect. Small-business rate is
 *  15%; the standard rate is 30%. Kept here so the saving shown to a creator is derived from one
 *  number rather than hardcoded per plan. */
export const APPLE_UPLIFT = 1.3;

/** The in-app (IAP) price for a plan, derived from the web price. App Store Connect price tiers are
 *  discrete, so the REAL charged price can differ by a few cents — this is for showing a saving,
 *  never for billing. */
export function inAppPriceCents(webPriceCents: number): number {
  return Math.round((webPriceCents * APPLE_UPLIFT) / 100) * 100; // round to a whole dollar
}

/** What a creator saves per month by subscribing on the web instead of in-app. Takes the web price
 *  directly: the plan catalogue is server-side (billing.ts pulls in the db + Stripe), and the
 *  paywall already fetches tiers at runtime rather than keeping a client copy to drift. */
export function webSavingCents(webPriceCents: number): number {
  return Math.max(0, inAppPriceCents(webPriceCents) - webPriceCents);
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}
