import { getUserFromRequest } from '@/lib/auth';
import { createBillingPortalSession } from '@/lib/billing';

// POST /api/creator/billing/portal — a Stripe Customer Portal URL where the creator manages
// or cancels their subscription, updates their card, and views invoices. 409 if they've
// never had a Stripe customer (nothing to manage yet — point them at the Paywall instead).
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const url = await createBillingPortalSession(user.id);
    if (!url) return Response.json({ error: 'no_billing_account' }, { status: 409 });
    return Response.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed';
    const status = /not configured|missing/.test(msg) ? 503 : 502;
    return Response.json({ error: msg }, { status });
  }
}
