// Custom-domain helpers for brand-store go-live (Vercel for everything). Each storefront is the
// `store-<slug>` Vercel project; attaching a domain there makes it the official live URL. Buying a
// new domain or transferring one in both end here — Vercel returns the DNS/TXT records to set when
// the domain isn't yet pointed at it, and verifies instantly for domains already in the account.
const VERCEL = 'https://api.vercel.com';

function token(): string {
  const t = process.env.VERCEL_TOKEN;
  if (!t) throw new Error('VERCEL_TOKEN not configured');
  return t;
}

export type DomainState = {
  name: string;
  verified: boolean;
  // When not verified, the records the owner must set at their registrar.
  verification?: { type: string; domain: string; value: string; reason: string }[];
};

/** Credits we charge a creator to buy a domain. 1 credit ≈ $0.01 retail, so the yearly price in
 *  dollars × 100 is cost; ×1.25 adds a small margin over Vercel's registration fee. */
export function domainCredits(priceUsd: number): number {
  return Math.ceil(priceUsd * 100 * 1.25);
}

/** Normalize user input to a bare hostname (no protocol, no path, lowercase). */
export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
}

/** Re-check verification for a domain already on the project. */
async function verifyDomain(project: string, domain: string): Promise<DomainState> {
  const res = await fetch(`${VERCEL}/v9/projects/${project}/domains/${domain}/verify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) throw new Error(`vercel verify-domain failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as DomainState;
}

export type DomainOffer = {
  domain: string;
  available: boolean;
  priceUsd: number | null; // yearly registration price, when purchasable
  period: number | null; // years the price covers (usually 1)
};

/** Check whether a domain can be bought and its yearly price (read-only — no charge). */
export async function searchDomain(domain: string): Promise<DomainOffer> {
  const auth = { Authorization: `Bearer ${token()}` };
  const statusRes = await fetch(`${VERCEL}/v4/domains/status?name=${encodeURIComponent(domain)}`, { headers: auth });
  if (!statusRes.ok) throw new Error(`vercel domain-status failed: ${statusRes.status}`);
  const { available } = (await statusRes.json()) as { available?: boolean };
  if (!available) return { domain, available: false, priceUsd: null, period: null };

  // Only new-registration price is relevant here.
  const priceRes = await fetch(`${VERCEL}/v4/domains/price?name=${encodeURIComponent(domain)}&type=new`, { headers: auth });
  if (!priceRes.ok) return { domain, available: true, priceUsd: null, period: null };
  const { price, period } = (await priceRes.json()) as { price?: number; period?: number };
  return { domain, available: true, priceUsd: typeof price === 'number' ? price : null, period: period ?? 1 };
}

/** Buy a domain into the Vercel account (charges the platform's Vercel billing). Vercel rejects a
 *  re-buy of an owned domain (409), which the caller treats as already-owned. */
export async function buyDomain(domain: string, expectedPriceUsd: number): Promise<void> {
  const res = await fetch(`${VERCEL}/v5/domains/buy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: domain, expectedPrice: expectedPriceUsd, renew: true }),
  });
  if (res.ok || res.status === 201) return;
  if (res.status === 409) return; // already owned in this account
  throw new Error(`vercel buy-domain failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
}

/** Attach a domain to the project (idempotent), returning its verification state. */
export async function attachDomain(project: string, domain: string): Promise<DomainState> {
  const res = await fetch(`${VERCEL}/v10/projects/${project}/domains`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: domain }),
  });
  if (res.ok) return (await res.json()) as DomainState;
  if (res.status === 409) return verifyDomain(project, domain); // already on the project → re-check
  throw new Error(`vercel attach-domain failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
}
