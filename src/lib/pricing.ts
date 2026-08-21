// Pricing floor — shared by the publish endpoint (authoritative) and the FinalizeSheet UI, so the
// minimum is identical everywhere. A product's retail price may never sit below its Printful base
// cost plus this margin: the platform fee already takes COGS + shipping + commission, so anything
// below cost would mean the creator (and the destination transfer) loses money on every sale.

export const MIN_MARGIN_CENTS = 500; // a product must clear at least $5 over its base cost
export const ABSOLUTE_FLOOR_CENTS = 500; // never below $5, even if the cost is momentarily unknown

/** The lowest retail price allowed for a variant given its Printful base cost (null when unknown). */
export function minRetailCents(costCents: number | null | undefined): number {
  return costCents != null ? costCents + MIN_MARGIN_CENTS : ABSOLUTE_FLOOR_CENTS;
}
