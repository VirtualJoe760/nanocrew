import { getUserFromRequest } from '@/lib/auth';
import { createOnboardingLink, ensureConnectedAccount, getConnectedAccount, refreshConnectedAccount } from '@/lib/connect';

// GET  /api/creator/connect — the creator's payout/Connect status (refreshed from Stripe).
// POST /api/creator/connect — create the account if needed and return a Stripe-hosted onboarding URL.
// Money from each brand's storefront routes to this account (a destination charge with the platform's
// application fee). Needs Stripe Connect enabled on the platform account — until then POST returns a
// clear "not available yet".

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // Refresh from Stripe when an account exists; otherwise report "not started".
  try {
    const status = (await getConnectedAccount(user.id)).stripeAccountId
      ? await refreshConnectedAccount(user.id)
      : await getConnectedAccount(user.id);
    return Response.json({
      connected: !!status.stripeAccountId,
      chargesEnabled: status.chargesEnabled,
      payoutsEnabled: status.payoutsEnabled,
      detailsSubmitted: status.detailsSubmitted,
      needsOnboarding: !status.chargesEnabled,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (!process.env.STRIPE_SECRET_KEY) return Response.json({ error: 'payments are not configured yet' }, { status: 503 });

  try {
    const accountId = await ensureConnectedAccount(user.id, user.email);
    const url = await createOnboardingLink(accountId);
    return Response.json({ url });
  } catch (e) {
    // Most common cause: Connect not enabled on the platform account yet.
    const msg = e instanceof Error ? e.message : 'failed';
    const notReady = /connect|platform|sign up for/i.test(msg);
    return Response.json({ error: notReady ? 'Payouts aren’t available yet — Connect is being set up.' : msg }, { status: notReady ? 503 : 502 });
  }
}
