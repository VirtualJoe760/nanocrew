import crypto from 'node:crypto';

// Modern Apple IAP verification via the App Store Server API (StoreKit 2) — replaces the deprecated
// verifyReceipt flow. The client (react-native-iap, StoreKit 2) sends us a transactionId; we fetch
// the signed transaction straight from Apple over an authenticated JWT and decode it. We trust the
// payload because it comes directly from Apple's API over TLS (not from the client), and we bind it
// to the buyer via appAccountToken (set to the creator's id at purchase time).
//
// Config (App Store Connect → Users and Access → Integrations → In-App Purchase key):
//   APPLE_IAP_KEY_ID, APPLE_IAP_ISSUER_ID, APPLE_IAP_PRIVATE_KEY (.p8 PEM), APPLE_BUNDLE_ID.

const KEY_ID = process.env.APPLE_IAP_KEY_ID;
const ISSUER_ID = process.env.APPLE_IAP_ISSUER_ID;
const PRIVATE_KEY = process.env.APPLE_IAP_PRIVATE_KEY;
const BUNDLE_ID = process.env.APPLE_BUNDLE_ID ?? 'com.nanocrew.app';

const PROD_API = 'https://api.storekit.itunes.apple.com';
const SANDBOX_API = 'https://api.storekit-sandbox.itunes.apple.com';

export function appStoreConfigured(): boolean {
  return Boolean(KEY_ID && ISSUER_ID && PRIVATE_KEY);
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

// A short-lived ES256 JWT authenticating us to the App Store Server API.
function signJwt(): string {
  if (!KEY_ID || !ISSUER_ID || !PRIVATE_KEY) throw new Error('app_store_not_configured');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
  const payload = { iss: ISSUER_ID, iat: now, exp: now + 600, aud: 'appstoreconnect-v1', bid: BUNDLE_ID };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  // The .p8 is PKCS8 PEM; env vars often store the newlines escaped — restore them.
  const key = crypto.createPrivateKey(PRIVATE_KEY.replace(/\\n/g, '\n'));
  // ieee-p1363 yields the raw r||s signature JOSE/JWT expects (not DER).
  const sig = crypto.sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64url(sig)}`;
}

export interface AppleTransaction {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  type: string; // 'Auto-Renewable Subscription' | 'Consumable' | 'Non-Consumable' | ...
  appAccountToken?: string;
  expiresDate?: number; // ms epoch — present for subscriptions
  revocationDate?: number; // ms epoch — present if refunded/revoked
}

// The signed transaction is a JWS; the middle segment is the JSON payload. Coming from Apple's
// authenticated API, we decode (don't re-verify the signature) — see file header.
function decodeJws(jws: string): AppleTransaction {
  const payload = jws.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AppleTransaction;
}

// Fetch + decode one transaction. Tries production first; a 404 there means it's a sandbox
// transaction (or vice-versa), so we fall back to the sandbox environment.
export async function fetchTransaction(transactionId: string): Promise<AppleTransaction | null> {
  const jwt = signJwt();
  const call = async (base: string): Promise<AppleTransaction | null> => {
    const res = await fetch(`${base}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`app_store_api_${res.status}`);
    const d = (await res.json()) as { signedTransactionInfo?: string };
    return d.signedTransactionInfo ? decodeJws(d.signedTransactionInfo) : null;
  };
  return (await call(PROD_API)) ?? (await call(SANDBOX_API));
}

export function isSubscription(t: AppleTransaction): boolean {
  return t.type === 'Auto-Renewable Subscription';
}
