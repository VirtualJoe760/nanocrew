// Server-side auth: verify a Supabase access token LOCALLY (Web Crypto, no network
// call). The old approach called Supabase's /auth/v1/user on every request — but on
// EAS Hosting (Cloudflare Workers) opening a postgres TCP socket *after* an outbound
// fetch() in the same request reliably fails, which broke EVERY authed DB route. By
// verifying the ES256 signature locally against the project's JWKS, authed routes make
// no fetch before their DB query, so they behave like the (reliable) public routes.

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const ISSUER = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1` : '';

export interface AuthedUser {
  id: string;
  email: string;
  /** Display name from the auth provider (e.g. Google), when available. */
  name?: string;
}

// Trusted server-to-server calls (e.g. first-drop generation) carry a shared internal key
// plus the creator they act on behalf of, so the normal auth + ownership checks all apply.
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? '';

type Jwk = { kid: string; kty: string; crv: string; x: string; y: string };
// Signing keys come from SUPABASE_JWKS (the project's JWKS json) so there's ZERO network
// I/O in the hot path. Falls back to fetching the JWKS once (cached) if the env is unset
// — set SUPABASE_JWKS in production so cold isolates never fetch before a DB query.
let jwksCache: Jwk[] | null = null;
const keyCache = new Map<string, CryptoKey>();

function b64urlToBytes(s: string): Uint8Array {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = norm + '='.repeat((4 - (norm.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToJson(s: string): unknown {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

async function getJwks(): Promise<Jwk[]> {
  if (jwksCache) return jwksCache;
  const env = process.env.SUPABASE_JWKS;
  if (env) {
    jwksCache = (JSON.parse(env) as { keys: Jwk[] }).keys;
    return jwksCache;
  }
  if (!ISSUER) return [];
  const res = await fetch(`${ISSUER}/.well-known/jwks.json`);
  jwksCache = ((await res.json()) as { keys: Jwk[] }).keys;
  return jwksCache;
}

async function keyFor(kid: string): Promise<CryptoKey | null> {
  const cached = keyCache.get(kid);
  if (cached) return cached;
  const jwk = (await getJwks()).find((k) => k.kid === kid);
  if (!jwk) return null;
  // Import only the bare EC public-key fields — extra JWK members (alg/use/key_ops)
  // can make importKey reject the key on some runtimes.
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  keyCache.set(kid, key);
  return key;
}

async function verifyToken(token: string): Promise<AuthedUser | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;

  let header: { alg?: string; kid?: string };
  let payload: { sub?: string; email?: string; exp?: number; aud?: string; iss?: string; user_metadata?: { full_name?: string; name?: string } };
  try {
    header = b64urlToJson(h) as typeof header;
    payload = b64urlToJson(p) as typeof payload;
  } catch {
    return null;
  }

  // Pin the algorithm (no 'none'/HS confusion) and require a key id.
  if (header.alg !== 'ES256' || !header.kid) return null;
  const key = await keyFor(header.kid);
  if (!key) return null;

  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    b64urlToBytes(sig) as unknown as BufferSource,
    new TextEncoder().encode(`${h}.${p}`) as unknown as BufferSource,
  );
  if (!ok) return null;

  if (typeof payload.exp === 'number' && Date.now() / 1000 >= payload.exp) return null;
  if (payload.aud !== 'authenticated') return null;
  if (ISSUER && payload.iss !== ISSUER) return null;
  if (!payload.sub || !payload.email) return null;

  const name = payload.user_metadata?.full_name ?? payload.user_metadata?.name;
  return { id: payload.sub, email: payload.email, name };
}

export async function getUserFromRequest(req: Request): Promise<AuthedUser | null> {
  // Internal service path: a valid key + creator id authenticates AS that creator.
  const internalKey = req.headers.get('x-internal-key');
  if (internalKey && INTERNAL_API_KEY && internalKey === INTERNAL_API_KEY) {
    const creatorId = req.headers.get('x-internal-creator');
    if (creatorId) return { id: creatorId, email: 'internal@nanocrew', name: 'internal' };
  }

  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    return await verifyToken(token);
  } catch {
    return null;
  }
}
