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
