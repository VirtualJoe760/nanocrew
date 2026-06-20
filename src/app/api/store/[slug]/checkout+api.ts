// POST /api/store/:slug/checkout { items: [{ variantId, quantity }] }
//   → forwards to the platform-api POS (/api/public/checkout) — the SAME Stripe→Printful
//     pipeline the storefront websites use, so prices come from the DB (client never trusted)
//     and the order/webhook flow is identical. Returns { url } (Stripe Checkout) for the app
//     to open in an in-app browser. Public (guest checkout), like the website.
//
//   When the buyer is SIGNED IN, we resolve their account email from the bearer token and pass
//   it through so the order attributes to the account up front (instead of the 'pending@checkout'
//   placeholder that the webhook later overwrites with the Stripe-collected email). This is what
//   lets the in-app "Purchases" surface (account.tsx → purchases.tsx) match orders by account
//   email. Guests stay anonymous and still match by the Stripe-collected email via the webhook.
//   No DB query here — getUserFromRequest verifies the token locally (Web Crypto, no fetch).
import { getUserFromRequest } from '@/lib/auth';

export async function POST(req: Request, { slug }: Record<string, string>) {
  const base = process.env.PLATFORM_API_BASE;
  if (!base) return Response.json({ error: 'Checkout is not configured yet' }, { status: 503 });
  try {
    const body = (await req.json().catch(() => null)) as {
      items?: { variantId: string; quantity: number }[];
    } | null;
    const items = (body?.items ?? []).filter((i) => i.variantId && i.quantity > 0);
    if (!items.length) return Response.json({ error: 'items required' }, { status: 400 });

    // Best-effort attribution: only attach an email when there's a valid signed-in user.
    const user = await getUserFromRequest(req);
    const customerEmail = user?.email?.includes('@') ? user.email : undefined;

    const res = await fetch(`${base.replace(/\/$/, '')}/api/public/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeSlug: slug, items, ...(customerEmail ? { customerEmail } : {}) }),
    });
    const data = (await res.json().catch(() => ({ error: 'checkout failed' }))) as Record<string, unknown>;
    return Response.json(data, { status: res.status });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Checkout failed' }, { status: 502 });
  }
}
