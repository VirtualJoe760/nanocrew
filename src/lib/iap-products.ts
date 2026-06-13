// Apple In-App Purchase product catalogue. Credits are CONSUMABLE IAP products; the in-app
// dollar price (set in App Store Connect) is higher than the web price to cover Apple's
// ~30% cut, but the credits granted match the web packs. Product IDs must match exactly
// what's configured in App Store Connect.

export interface IapCreditProduct {
  productId: string; // App Store Connect product identifier
  credits: number;
  label: string;
}

export const IAP_CREDIT_PRODUCTS: IapCreditProduct[] = [
  { productId: 'com.nanocrew.credits.500', credits: 500, label: '500 credits' },
  { productId: 'com.nanocrew.credits.1500', credits: 1500, label: '1,500 credits' },
  { productId: 'com.nanocrew.credits.5000', credits: 5000, label: '5,000 credits' },
];

export function creditsForProduct(productId: string): number {
  return IAP_CREDIT_PRODUCTS.find((p) => p.productId === productId)?.credits ?? 0;
}

export const ALL_IAP_PRODUCT_IDS = IAP_CREDIT_PRODUCTS.map((p) => p.productId);
