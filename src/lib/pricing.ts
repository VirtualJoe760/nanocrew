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

// The floor is a SAFETY RAIL, not a price. Opening the pricing step at it meant a creator who
// accepted the defaults earned ~$5 a sale minus commission (BUG_AUDIT_2026-08-20 #46 — the tee
// floor is $24.69 on a $19.69 base). The suggestion below is a normal creator-brand markup,
// rounded to a .99 price point, and the creator can move it anywhere at or above the floor.
const SUGGESTED_MULTIPLE = 1.9;

/** Round UP to the next .99 price point ($37.41 → $37.99). */
function toNinetyNine(cents: number): number {
  return Math.ceil((cents - 99) / 100) * 100 + 99;
}

/** The price the pricing step OPENS at: a real markup on the base cost, never below the floor. */
export function suggestedRetailCents(costCents: number | null | undefined): number {
  const floor = minRetailCents(costCents);
  if (costCents == null) return floor;
  return Math.max(floor, toNinetyNine(Math.round(costCents * SUGGESTED_MULTIPLE)));
}
