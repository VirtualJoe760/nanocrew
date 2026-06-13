import { getUserFromRequest } from '@/lib/auth';
import { createCreditPackCheckout, createSubscriptionCheckout, type PaidPlan } from '@/lib/billing';

// POST /api/creator/billing/checkout — start a Stripe Checkout session and return its URL
// for the client to open in a browser.
//   { kind: 'subscription', plan } — subscribe to a tier (web Stripe price).
//   { kind: 'credit_pack', packId } — buy a one-time credit pack.
// The webhook (platform-api) is what actually activates the plan / grants the credits.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { kind?: 'subscription' | 'credit_pack'; plan?: PaidPlan; packId?: string }
    | null;
  if (!body?.kind) return Response.json({ error: 'kind required' }, { status: 400 });

  try {
    let url: string;
    if (body.kind === 'subscription') {
      if (!body.plan) return Response.json({ error: 'plan required' }, { status: 400 });
      url = await createSubscriptionCheckout(user.id, user.email, body.plan);
    } else {
      if (!body.packId) return Response.json({ error: 'packId required' }, { status: 400 });
      url = await createCreditPackCheckout(user.id, user.email, body.packId);
    }
    return Response.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'checkout failed';
    // Missing price config is an operator problem, not the creator's — surface clearly.
    const status = /not configured|missing/.test(msg) ? 503 : 502;
    return Response.json({ error: msg }, { status });
  }
}
