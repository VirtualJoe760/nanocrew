// POST /api/customer/returns { orderId, reason, photoUrls?, note?, items? }
//   Thin app proxy for the signed-in buyer's "Request a return" action (account.tsx →
//   purchases.tsx). Returns logic + money movement + emails all live CENTRAL in platform-api
//   (thin-client rule) — this only resolves the authed buyer and forwards to the public returns
//   endpoint, the same way checkout+api.ts forwards to /api/public/checkout. We attach the
//   account email so the platform can confirm the claim belongs to the buyer (it still validates
//   the window + reason + photo + ownership server-side). No DB query here — the token is
//   verified locally (Web Crypto, no fetch) before the outbound call.
import { getUserFromRequest } from '@/lib/auth';

type ReturnReason = 'defective' | 'wrong_item' | 'damaged' | 'not_received';
const REASONS: ReturnReason[] = ['defective', 'wrong_item', 'damaged', 'not_received'];

export async function POST(req: Request) {
  const base = process.env.PLATFORM_API_BASE;
  if (!base) return Response.json({ error: 'Returns are not available yet' }, { status: 503 });

  // Must be signed in — the in-app return flow is account-attributed.
  const user = await getUserFromRequest(req);
  if (!user?.email) return Response.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const body = (await req.json().catch(() => null)) as {
      orderId?: string;
      reason?: string;
      photoUrls?: string[];
      note?: string;
      items?: unknown;
    } | null;

    const orderId = body?.orderId?.trim();
    const reason = body?.reason as ReturnReason | undefined;
    if (!orderId) return Response.json({ error: 'orderId required' }, { status: 400 });
    if (!reason || !REASONS.includes(reason)) return Response.json({ error: 'a valid reason is required' }, { status: 400 });

    const photoUrls = Array.isArray(body?.photoUrls)
      ? body.photoUrls.filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 8)
      : [];
    // Photo evidence is required for defective/damaged claims (mirrors the platform-api validation,
    // so we fail fast with a clear message instead of a generic 4xx from the proxied call).
    if ((reason === 'defective' || reason === 'damaged') && !photoUrls.length) {
      return Response.json({ error: 'Add at least one photo for a defective or damaged item.' }, { status: 400 });
    }

    const res = await fetch(`${base.replace(/\/$/, '')}/api/public/returns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId,
        reason,
        photoUrls,
        note: typeof body?.note === 'string' ? body.note.slice(0, 2000) : undefined,
        items: body?.items ?? undefined,
        // The verified account email — the platform gates the claim against the order's customerEmail.
        customerEmail: user.email,
      }),
    });
    const data = (await res.json().catch(() => ({ error: 'return request failed' }))) as Record<string, unknown>;
    return Response.json(data, { status: res.status });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Return request failed' }, { status: 502 });
  }
}
