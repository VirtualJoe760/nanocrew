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

/** Flat service charge added on top of a domain's registration price, in cents ($2.99). */
export const DOMAIN_SERVICE_FEE_CENTS = 299;

/** Credits we charge a creator to buy a domain. 1 credit ≈ $0.01 retail. Vercel's yearly
 *  registration price is passed through at par (dollars × 100) plus a flat $2.99 service fee —
 *  our margin. e.g. a $6.99 domain → 699 + 299 = 998 credits ($9.98). */
export function domainCredits(priceUsd: number): number {
  return Math.ceil(priceUsd * 100) + DOMAIN_SERVICE_FEE_CENTS;
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

// Registrant contact for purchases — Vercel's registrar API requires full contact info on every buy.
// We use one platform business contact (env) as the registrant; the creator owns the SITE and the
// domain is attached to their store. Set DOMAIN_CONTACT_* to enable buying.
interface RegistrantContact {
  firstName: string; lastName: string; email: string; phone: string; // E.164 e.g. +14155550100
  address1: string; city: string; state: string; zip: string; country: string; // ISO alpha-2
}
function platformContact(): RegistrantContact {
  const e = process.env;
  const c = {
    firstName: e.DOMAIN_CONTACT_FIRST_NAME, lastName: e.DOMAIN_CONTACT_LAST_NAME, email: e.DOMAIN_CONTACT_EMAIL,
    phone: e.DOMAIN_CONTACT_PHONE, address1: e.DOMAIN_CONTACT_ADDRESS1, city: e.DOMAIN_CONTACT_CITY,
    state: e.DOMAIN_CONTACT_STATE, zip: e.DOMAIN_CONTACT_ZIP, country: e.DOMAIN_CONTACT_COUNTRY,
  };
  const missing = Object.entries(c).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`domain registrant not configured — set DOMAIN_CONTACT_* (missing: ${missing.join(', ')})`);
  return c as RegistrantContact;
}

/** Check whether a domain can be bought and its yearly price (read-only — no charge). Registrar API. */
export async function searchDomain(domain: string): Promise<DomainOffer> {
  const auth = { Authorization: `Bearer ${token()}` };
  const availRes = await fetch(`${VERCEL}/v1/registrar/domains/${encodeURIComponent(domain)}/availability`, { headers: auth });
  if (!availRes.ok) throw new Error(`vercel availability failed: ${availRes.status} ${(await availRes.text()).slice(0, 160)}`);
  const { available } = (await availRes.json()) as { available?: boolean };
  if (!available) return { domain, available: false, priceUsd: null, period: null };

  const priceRes = await fetch(`${VERCEL}/v1/registrar/domains/${encodeURIComponent(domain)}/price`, { headers: auth });
  if (!priceRes.ok) return { domain, available: true, priceUsd: null, period: null };
  const { purchasePrice, years } = (await priceRes.json()) as { purchasePrice?: number | null; years?: number };
  return { domain, available: true, priceUsd: typeof purchasePrice === 'number' ? purchasePrice : null, period: years ?? 1 };
}

/** Buy a domain into the Vercel account (charges the platform's Vercel billing). Registrar API:
 *  requires the registrant contact + an expectedPrice that matches. Returns the order id. */
export async function buyDomain(domain: string, expectedPriceUsd: number): Promise<{ orderId: string }> {
  const res = await fetch(`${VERCEL}/v1/registrar/domains/${encodeURIComponent(domain)}/buy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoRenew: true, years: 1, expectedPrice: expectedPriceUsd, contactInformation: platformContact() }),
  });
  const d = (await res.json().catch(() => ({}))) as { orderId?: string; code?: string; message?: string };
  if (res.ok) return { orderId: d.orderId ?? '' };
  if (d.code === 'expected_price_mismatch') throw new Error('the domain price changed — search again before buying');
  if (d.code === 'order_too_expensive') throw new Error('that domain costs more than expected');
  if (d.code === 'additional_contact_info_required') throw new Error('this TLD needs extra registrant info we don’t collect yet');
  throw new Error(`vercel buy-domain failed: ${res.status} ${d.message ?? d.code ?? ''}`);
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
