import crypto from 'node:crypto';

// APP STORE CONNECT — adding a beta tester to the external TestFlight group.
//
// Why by hand rather than a client library: this is two REST calls behind an ES256 JWT, and
// platform-api deliberately carries no SDKs it doesn't need (same reasoning as lib/notify.ts talking
// to Resend over raw fetch).
//
// Credentials come from the env, NOT from eas.json — Vercel has no checkout. They mirror the values
// EAS already uses for this app:
//   ASC_KEY_ID     e.g. SP238255VU
//   ASC_ISSUER_ID  the Users and Access → Integrations issuer UUID
//   ASC_PRIVATE_KEY the contents of AuthKey_<KEY_ID>.p8 (newlines may be \n-escaped)
//   ASC_APP_ID     the numeric App Store Connect app id
//   ASC_BETA_GROUP_ID the EXTERNAL group new public signups join
//
// Unconfigured, every call reports `skipped` and the caller records the signup without a slot — the
// same log-and-no-op shape the mailer uses, so a missing secret degrades instead of throwing.

const API = 'https://api.appstoreconnect.apple.com';

export type TesterResult =
  | { ok: true }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped?: false; reason: string };

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export function testflightConfigured(): boolean {
  return Boolean(env('ASC_KEY_ID') && env('ASC_ISSUER_ID') && env('ASC_PRIVATE_KEY') && env('ASC_BETA_GROUP_ID'));
}

/** DER (ASN.1 SEQUENCE of two INTEGERs) → JOSE (r‖s, 32 bytes each), which is what ES256 wants. */
function derToJose(der: Buffer): Buffer {
  const seq = der[1] === 0x81 ? der.subarray(3) : der.subarray(2);
  let i = 0;
  const readInt = (): Buffer => {
    i++; // 0x02 tag
    const len = seq[i++];
    const v = seq.subarray(i, i + len);
    i += len;
    return v.length > 32 ? v.subarray(v.length - 32) : Buffer.concat([Buffer.alloc(32 - v.length), v]);
  };
  return Buffer.concat([readInt(), readInt()]);
}

function token(): string {
  const keyId = env('ASC_KEY_ID')!;
  const issuer = env('ASC_ISSUER_ID')!;
  // Vercel env vars can't hold real newlines comfortably — accept the \n-escaped form too.
  const pem = env('ASC_PRIVATE_KEY')!.replace(/\\n/g, '\n');
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'ES256', kid: keyId, typ: 'JWT' });
  const payload = b64({ iss: issuer, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' });
  const signer = crypto.createSign('SHA256');
  signer.update(`${header}.${payload}`);
  const sig = derToJose(signer.sign(pem));
  return `${header}.${payload}.${sig.toString('base64url')}`;
}

async function asc(path: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* Apple returns text on some errors */
  }
  return { status: res.status, body };
}

function apiError(body: unknown): string {
  const errs = (body as { errors?: { title?: string; detail?: string }[] } | null)?.errors;
  if (errs?.length) return errs.map((e) => e.detail || e.title).filter(Boolean).join('; ').slice(0, 300);
  return typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body ?? {}).slice(0, 200);
}

/** How many people currently hold an external TestFlight slot. `null` when we can't tell. */
export async function testflightTesterCount(): Promise<number | null> {
  if (!testflightConfigured()) return null;
  try {
    const group = env('ASC_BETA_GROUP_ID')!;
    const r = await asc(`/v1/betaGroups/${group}/betaTesters?limit=1`);
    if (r.status !== 200) return null;
    const total = (r.body as { meta?: { paging?: { total?: number } } })?.meta?.paging?.total;
    return typeof total === 'number' ? total : null;
  } catch {
    return null;
  }
}

/**
 * Put an address on the external TestFlight group — this is what actually sends the invite.
 * Idempotent in practice: an address already on the group comes back as a duplicate, which is a
 * success from the signer's point of view (they have their build), not an error to show them.
 */
export async function addTestFlightTester(email: string): Promise<TesterResult> {
  if (!testflightConfigured()) return { ok: false, skipped: true, reason: 'App Store Connect not configured' };
  try {
    const group = env('ASC_BETA_GROUP_ID')!;
    const r = await asc('/v1/betaTesters', {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'betaTesters',
          attributes: { email },
          relationships: { betaGroups: { data: [{ type: 'betaGroups', id: group }] } },
        },
      }),
    });
    if (r.status === 201) return { ok: true };
    const reason = apiError(r.body);
    // 409 with an "already exists" style error means the slot is already theirs.
    if (r.status === 409 || /already|duplicate/i.test(reason)) return { ok: true };
    return { ok: false, reason: `${r.status} ${reason}` };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'App Store Connect call failed' };
  }
}
